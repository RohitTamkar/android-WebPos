import { createHash } from 'node:crypto';
import { productFields } from './productDefaults.js';
import { parseProductCsv } from '../../frontend/src/pages/productCsvPreview.js';

// Approved for user-triggered, create-only imports into the existing PRODUCT collection.
export const PRODUCT_IMPORT_WRITES_ENABLED = true;
export interface ImportCategory { id: string; name: string; categoryNo: number | null }
export interface ImportTax { percent: number; index: number; type: number }
export interface ImportIssue { column: string; message: string }
export interface ImportDocument { rowNumber: number; fields: Record<string, string | number | boolean>; sourceIdentity?: string }
// Automatic Search Codes do not distinguish otherwise identical products.
const identityFields = ['name', 'regionalName', 'price', 'priceTable', 'mrpPrice', 'costPrice', 'category', 'taxIndex', 'barcode', 'unitId', 'currentStock', 'weighable'];
export function productIdentity(fields: Record<string, unknown>): string {
  return JSON.stringify(identityFields.map(key => fields[key]));
}

export function validateProductImport(source: string, categories: ImportCategory[], taxes: ImportTax[] = []) {
  const preview = parseProductCsv(source);
  const documents: ImportDocument[] = [];
  const rows = preview.rows.map(row => ({ rowNumber: row.rowNumber, errors: [...row.errors] }));
  if (preview.headerErrors.length || !rows.length || rows.some(row => row.errors.length)) {
    return { canUpload: false, categoryChecked: false, headerErrors: preview.headerErrors, rows, documents };
  }
  const identities = new Map<string, number>();
  preview.rows.forEach((row, index) => {
    const c = row.cells.map(cell => cell.trim());
    const errors = rows[index]!.errors;
    for (const column of [2, 3, 4, 5, 7, 8, 11]) {
      if (!c[column]?.trim() || !Number.isFinite(Number(c[column]))) errors.push({ column: preview.headers[column]!, message: 'A finite numeric value is required to construct the product.' });
    }
    if (Number(c[2]) !== Number(c[3])) errors.push({ column: 'Price 1', message: 'Price 1 must equal Default Price for the supplied single-entry priceTable. A separate Price 1 mapping has not been supplied.' });
    if (c[10] !== 'number') errors.push({ column: 'Unit Type', message: 'Only number (unitId 2) is supported by the supplied product template.' });
    if (Number(c[11]) !== 0) errors.push({ column: 'Stock', message: 'Only zero opening stock is supported until the stock-initialization workflow is specified.' });
    if (!['yes', 'no'].includes(c[12]?.toLowerCase() ?? '')) errors.push({ column: 'Weightable', message: 'Weightable must be yes or no.' });
    const matches = categories.filter(category => category.name === c[6] && category.categoryNo === Number(c[7]));
    if (matches.length !== 1) {
      const numbered = categories.filter(category => category.categoryNo === Number(c[7]));
      const message = numbered.length === 1
        ? `Category No ${c[7]} is named ${JSON.stringify(numbered[0]!.name)}, but the file says ${JSON.stringify(c[6])}. Use the existing category name in the file.`
        : 'Name and number must identify exactly one existing category in this outlet.';
      errors.push({ column: 'Category Name / Category No', message });
    }
    const tax = taxes.filter(tax => tax.type === 0 && tax.percent === Number(c[8]));
    if (tax.length !== 1) errors.push({ column: 'Tax', message: 'Tax must identify exactly one GST percentage in the existing TAX_MASTER.' });
    if (errors.length) return;
    const fields = productFields({
      name: c[0]!, regionalName: c[1]!, price: Number(c[2]), mrpPrice: Number(c[4]),
      costPrice: Number(c[5]), category: matches[0]!.id, discount: 0, shortName: '',
      taxIndex: tax[0]!.index, hsnCode: '', unitId: 2,
      weighable: c[12]!.toLowerCase() === 'yes', stockable: false,
    }, index + 1, c[9]!);
    const identity = productIdentity(fields);
    const first = identities.get(identity);
    if (first !== undefined) {
      errors.push({ column: 'Entire row', message: `Repeated product matches spreadsheet row ${first}; duplicate rows must be resolved before upload.` });
      return;
    }
    identities.set(identity, row.rowNumber);
    documents.push({ rowNumber: row.rowNumber, fields, sourceIdentity: JSON.stringify(c) });
  });
  const canUpload = rows.every(row => !row.errors.length);
  return { canUpload, categoryChecked: true, headerErrors: [] as string[], rows, documents: canUpload ? documents : [] };
}

export interface ImportValidationDependencies {
  readProfile: (id: string) => Promise<Record<string, unknown> | undefined>;
  assignedOutlets: (profile: Record<string, unknown>) => string[];
  readCategories: (outletId: string) => Promise<ImportCategory[]>;
  readTaxes: () => Promise<ImportTax[]>;
  readProducts: (outletId: string) => Promise<StoredImportProduct[]>;
}
export async function checkAuthorizedProductImport(profileId: string | null, outletId: string, source: unknown, deps: ImportValidationDependencies, acceptAttempt?: () => void) {
  if (!profileId) return { status: 401, body: { success: false, message: 'Your session has expired. Please sign in again.' } };
  if (!outletId || outletId.includes('/')) return { status: 400, body: { success: false, message: 'A valid outlet is required.' } };
  const profile = await deps.readProfile(profileId);
  if (!profile || profile.active !== true) return { status: 403, body: { success: false, message: 'This user account is inactive or unavailable.' } };
  if (!deps.assignedOutlets(profile).includes(outletId)) return { status: 403, body: { success: false, message: 'You do not have access to this outlet.' } };
  acceptAttempt?.();
  if (typeof source !== 'string') return { status: 400, body: { success: false, message: 'The original spreadsheet text is required.' } };
  let local: ReturnType<typeof validateProductImport>;
  try { local = validateProductImport(source, []); }
  catch (error) { return { status: 400, body: { success: false, message: error instanceof Error ? error.message : 'Invalid spreadsheet.' } }; }
  if (!local.categoryChecked) return { status: 422, body: { success: false, data: local } };
  const [categories, taxes] = await Promise.all([deps.readCategories(outletId), deps.readTaxes()]);
  const data = validateProductImport(source, categories, taxes);
  if (data.canUpload) {
    const existing = await deps.readProducts(outletId);
    try { data.documents = allocateProductCodes(outletId, data.documents, existing); }
    catch (error) {
      return { status: 409, body: { success: false, message: error instanceof Error ? error.message : 'Unable to allocate Search Codes safely.' } };
    }
  }
  return { status: data.canUpload ? 200 : 422, body: { success: data.canUpload, data } };
}

export interface StoredImportProduct { id: string; fields: Record<string, unknown> }
// Search Codes are numeric safe integers; legacy numeric strings are read without rewriting them.
export function numericSearchCode(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())) return null;
  const code = Number(value);
  if (!Number.isFinite(code) || !Number.isInteger(code)) return null;
  if (!Number.isSafeInteger(code)) throw new Error('An existing numeric Search Code exceeds the safe integer range. No products were overwritten.');
  return code;
}

export function nextProductCode(existing: StoredImportProduct[]): number {
  let highest = 0;
  for (const record of existing) highest = Math.max(highest, numericSearchCode(record.fields.code) ?? 0);
  if (!Number.isSafeInteger(highest + 1)) throw new Error('No safe numeric Search Codes remain.');
  return highest + 1;
}

export function allocateProductCodes(outletId: string, documents: ImportDocument[], existing: StoredImportProduct[]): ImportDocument[] {
  let highest = 0;
  for (const record of existing) highest = Math.max(highest, numericSearchCode(record.fields.code) ?? 0);
  const byId = new Map(existing.map(record => [record.id, record]));
  const byIdentity = new Map(existing.map(record => [productIdentity(record.fields), record]));
  return documents.map(document => {
    // Keep the established hash and source-row convention for reconciliation after timeouts.
    const id = typeof document.fields.id === 'string' ? document.fields.id : createHash('sha256').update(`${outletId}\n${document.sourceIdentity ?? JSON.stringify([...JSON.parse(productIdentity(document.fields)), document.fields.code])}`).digest('hex').slice(0, 20);
    const saved = byId.get(id);
    const duplicate = byIdentity.get(productIdentity(document.fields));
    if (duplicate && duplicate.id !== id) throw new Error(`Row ${document.rowNumber} already matches an existing product. No products were overwritten.`);
    if (saved) {
      const expected = { ...document.fields, id };
      if (Object.keys(saved.fields).filter(key => key !== 'dateTme').length !== Object.keys(expected).length
        || Object.entries(expected).some(([key, value]) => key !== 'code' && saved.fields[key] !== value)
        || numericSearchCode(saved.fields.code) === null) {
        throw new Error('An existing product differs from the planned import. It will not be overwritten.');
      }
      return { ...document, fields: { ...expected, code: saved.fields.code as string | number } };
    }
    if (!Number.isSafeInteger(highest + 1)) throw new Error('No safe numeric Search Codes remain.');
    return { ...document, fields: { ...document.fields, id, code: ++highest } };
  });
}

export function assertPreviewCodes(expected: ImportDocument[], actual: ImportDocument[]) {
  if (expected.length !== actual.length || expected.some((document, index) =>
    document.rowNumber !== actual[index]?.rowNumber || document.fields.code !== actual[index]?.fields.code)) {
    throw new Error('Search Codes changed since preview. Review the updated preview before uploading again.');
  }
}

export interface ImportWriter {
  enabled: boolean;
  readExisting: (outletId: string) => Promise<StoredImportProduct[]>;
  createChunk: (outletId: string, documents: ImportDocument[]) => Promise<{ created: number; existing: number }>;
}
export async function persistProductImport(outletId: string, documents: ImportDocument[], writer: ImportWriter) {
  if (!writer.enabled) return { success: false, created: 0, existing: 0, confirmedRows: [] as number[], unconfirmedRows: documents.map(d => d.rowNumber), message: 'Production upload is disabled pending review and approval.' };
  if (!documents.length) throw new Error('No fully validated products to import.');
  const planned = allocateProductCodes(outletId, documents, await writer.readExisting(outletId));
  if (documents.every(document => document.fields.id)) assertPreviewCodes(documents, planned);
  let created = 0, reused = 0;
  const confirmedRows: number[] = [];
  for (let index = 0; index < planned.length; index += 100) {
    const chunk = planned.slice(index, index + 100);
    try {
      const result = await writer.createChunk(outletId, chunk);
      created += result.created; reused += result.existing;
      confirmedRows.push(...chunk.map(document => document.rowNumber));
    } catch {
      return { success: false, created, existing: reused, confirmedRows, unconfirmedRows: planned.slice(index).map(document => document.rowNumber),
        message: 'Import stopped. Later rows have an unconfirmed outcome. Retrying the same file reconciles the same document IDs without overwriting products.' };
    }
  }
  return { success: true, created, existing: reused, confirmedRows, unconfirmedRows: [] as number[], message: `${created} products added; ${reused} already confirmed from this import.` };
}
