import { checkAuthorizedProductImport, persistProductImport, type ImportValidationDependencies, type ImportWriter } from './productImportValidation.js';
import { planImportCategories, type CategoryResolution } from './productImportCategories.js';
import { parseProductCsv, type ProductUploadMode } from '../../frontend/src/pages/productCsvPreview.js';

export async function persistProductImportWithCategories(outletId: string, profileId: string, source: string, codes: unknown[],
  deps: ImportValidationDependencies, resolve: () => Promise<CategoryResolution>, writer: ImportWriter, mode: ProductUploadMode = 'standard') {
  let rowNumbers: number[];
  try { rowNumbers = parseProductCsv(source, mode).rows.map(row => row.rowNumber); }
  catch (error) {
    return { success: false, created: 0, existing: 0, confirmedRows: [] as number[], unconfirmedRows: [] as number[],
      categoriesCreated: 0, categoriesReused: 0, failedRows: null,
      message: `${error instanceof Error ? error.message : 'Invalid spreadsheet.'} No categories or products were written; product row counts could not be determined.` };
  }
  const empty = { success: false, created: 0, existing: 0, confirmedRows: [] as number[], unconfirmedRows: rowNumbers };
  // This service also checks validation when called outside the Express route.
  const initial = await checkAuthorizedProductImport(profileId, outletId, source, deps, undefined, mode);
  if (initial.status !== 200 || !initial.body.data?.canUpload || !writer.enabled) {
    return { ...empty, categoriesCreated: 0, categoriesReused: 0, failedRows: rowNumbers.length,
      message: initial.body.message ?? 'File validation or import authorization failed. No categories or products were written.' };
  }
  if (codes.length !== initial.body.data.documents.length || codes.some((code, index) => code !== initial.body.data!.documents[index]!.fields.code)) {
    return { ...empty, categoriesCreated: 0, categoriesReused: 0, failedRows: rowNumbers.length,
      message: 'Search Codes changed since preview. No categories or products were written. Preview again.' };
  }
  const resolved = await resolve();
  const summary = { categoriesCreated: resolved.created, categoriesReused: resolved.reused };
  const categoryText = `${resolved.reused} categories reused; ${resolved.created} categories created.`;
  if (!resolved.success) return { ...empty, ...summary, failedRows: rowNumbers.length, categoryFailures: resolved.issues,
    message: `${resolved.reused} categories reused; ${resolved.created} category creations confirmed. Category resolution failed. No products were attempted. ${resolved.issues.slice(0, 8).map(issue => `Row ${issue.rowNumber}: ${issue.message}`).join(' ')}` };
  try {
    // Rebuild products using persisted category IDs, then recheck product codes and
    // identities. Preview-only category IDs never reach the product writer.
    const checked = await checkAuthorizedProductImport(profileId, outletId, source, { ...deps, readCategories: async () => resolved.categories }, undefined, mode);
    if (checked.status !== 200 || !checked.body.data?.canUpload || planImportCategories(source, resolved.categories, mode).missing.length > 0) {
      const issues = checked.body.data?.rows.flatMap(row => row.errors.map(issue => `Row ${row.rowNumber}: ${issue.message}`)) ?? [];
      return { ...empty, ...summary, failedRows: rowNumbers.length, message: `${categoryText} No products were attempted. ${checked.body.message ?? issues.slice(0, 8).join(' ')}` };
    }
    if (codes.length !== checked.body.data.documents.length || codes.some((code, index) => code !== checked.body.data!.documents[index]!.fields.code)) {
      return { ...empty, ...summary, failedRows: rowNumbers.length, message: `${categoryText} Search Codes changed. No products were attempted. Preview the same file again.` };
    }
    const result = await persistProductImport(outletId, checked.body.data.documents, writer);
    return { ...result, ...summary, failedRows: result.unconfirmedRows.length,
      message: `${categoryText} ${result.created} products imported; ${result.existing} previously imported products confirmed; ${result.unconfirmedRows.length} failed or unconfirmed product rows. ${result.message}` };
  } catch (error) {
    const known = error instanceof Error && /^(Row \d+ already|Search Codes changed|An existing product differs|An existing numeric Search Code|No safe numeric Search Codes)/.test(error.message);
    return { ...empty, ...summary, failedRows: rowNumbers.length,
      message: `${categoryText} Products were not confirmed. ${known ? error.message : 'Retry the same file to reconcile safely; created categories are retained.'}` };
  }
}
