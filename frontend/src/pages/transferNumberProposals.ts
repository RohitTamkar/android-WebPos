export interface ProposalCategory { id: string; name: string; categoryNo: unknown }
export interface ProposalProduct { documentId: string; fields: Record<string, unknown> }
export interface NumberProposal { id: string; proposed: number | null; conflicts: string[]; error: string }
const normalized = (value: unknown) => typeof value === 'string' ? value.trim().toLowerCase() : '';
const barcode = (value: unknown) => typeof value === 'string' && value.trim() !== '0' ? value.trim() : '';

// Match CategoryPage's highest safe category number + 1 convention; do not fill gaps.
function highestCategoryNumber(records: readonly ProposalCategory[]) {
  let highest = 0;
  for (const record of records) {
    const value = typeof record.categoryNo === 'number' || typeof record.categoryNo === 'string' ? Number(record.categoryNo) : NaN;
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) throw new Error('A destination category number is outside the safe integer range.');
    if (Number.isSafeInteger(value)) highest = Math.max(highest, value);
  }
  return highest;
}

// Same numeric-code parsing as backend productImportValidation.numericSearchCode/nextProductCode.
// Kept pure here so the browser does not import server crypto, persistence, or Firestore modules.
function highestProductCode(records: readonly ProposalProduct[]) {
  let highest = 0;
  for (const record of records) {
    const value = record.fields.code;
    if (typeof value !== 'number' && typeof value !== 'string') continue;
    if (typeof value === 'string' && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())) continue;
    const code = Number(value);
    if (!Number.isFinite(code) || !Number.isInteger(code)) continue;
    if (!Number.isSafeInteger(code)) throw new Error('A destination product code is outside the safe integer range.');
    highest = Math.max(highest, code);
  }
  return highest;
}
function allocate<T>(selected: readonly T[], id: (record: T) => string, highest: () => number,
  conflicts: (record: T) => string[]): NumberProposal[] {
  const unique = [...new Map(selected.map(record => [id(record), record])).values()];
  let next: number;
  try { next = highest(); }
  catch (error) { return unique.map(record => ({ id: id(record), proposed: null, conflicts: conflicts(record), error: (error as Error).message })); }
  return unique.map(record => {
    const valid = Number.isSafeInteger(next + 1);
    return { id: id(record), proposed: valid ? ++next : null, conflicts: conflicts(record), error: valid ? '' : 'No safe destination numbers remain.' };
  });
}

// Proposals only: no records are merged or modified, including same-name/barcode matches.
export function proposeCategoryNumbers(selected: readonly ProposalCategory[], destination: readonly ProposalCategory[]) {
  return allocate(selected, record => record.id, () => highestCategoryNumber(destination), category => destination
    .filter(target => !!normalized(category.name) && normalized(target.name) === normalized(category.name))
    .map(target => `Category name matches ${target.name}; identity needs review. No merge or save.`));
}
export function proposeProductCodes(selected: readonly ProposalProduct[], destination: readonly ProposalProduct[]) {
  return allocate(selected, record => record.documentId, () => highestProductCode(destination), product => destination.flatMap(target => {
    const warnings: string[] = [];
    if (normalized(product.fields.name) && normalized(product.fields.name) === normalized(target.fields.name)) warnings.push(`Product name matches ${String(target.fields.name)}; identity needs review.`);
    if (barcode(product.fields.barcode) && barcode(product.fields.barcode) === barcode(target.fields.barcode)) warnings.push(`Barcode matches ${String(target.fields.name ?? target.documentId)}; identity needs review.`);
    return warnings;
  }));
}
