import ExcelJS from 'exceljs';
import { ANDROID_TAX_OPTIONS } from '../../shared/androidTaxes.js';
import { PRODUCT_UNITS, ProductCreationError, requireProductOutlet } from './productCreation.js';

export const PRODUCT_EXCEL_COLUMNS = [
  'Product Name', 'Regional Name', 'defaultPrice', 'price', 'MRP Price', 'Purchase Price',
  'Category Name', 'Category No', 'Tax', 'Barcode', 'Unit Type', 'Stock', 'Weightable', 'Search Code', 'Hsn Code',
];
export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export interface ProductExportDependencies {
  readProfile(id: string): Promise<Record<string, unknown> | undefined>;
  assignedOutlets(profile: Record<string, unknown>): string[];
  readProducts(id: string): Promise<{ id: string; fields: Record<string, unknown> }[]>;
  readCategories(id: string): Promise<{ id: string; name: string; categoryNo: number | null }[]>;
  readPremises(id: string): Promise<{ id: string; name: string }[]>;
}

const text = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value) : '';
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value
  : typeof value === 'string' && value.trim() && Number.isFinite(Number(value)) ? Number(value) : '';
const normalize = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();

function priceTable(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null || value === '') return {};
  let parsed = value;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); } catch { throw new ProductCreationError(422, 'A product has an invalid price table. Correct it before exporting so premises prices are not lost.'); }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new ProductCreationError(422, 'A product has an invalid price table. Unable to preserve its premises prices.');
  return parsed as Record<string, unknown>;
}

function addRow(sheet: ExcelJS.Worksheet, values: (string | number)[]) {
  if (sheet.rowCount >= 1_048_576) throw new ProductCreationError(422, 'The export exceeds the Excel worksheet row limit.');
  if (values.some(value => typeof value === 'string' && value.length > 32767)) throw new ProductCreationError(422, 'A product value exceeds the Excel cell text limit.');
  sheet.addRow(values);
}

// Both delivery paths read the complete outlet collections through the existing readers.
// Authorization finishes before any product/category/premises data is requested.
export async function createProductExport(deps: ProductExportDependencies, outletId: string, profileId: string | null) {
  if (!profileId) throw new ProductCreationError(401, 'Your session has expired. Please sign in again.');
  if (!outletId || outletId.length > 200 || outletId.includes('/') || outletId === '.' || outletId === '..') throw new ProductCreationError(400, 'A valid outlet is required.');
  requireProductOutlet(profileId, outletId, await deps.readProfile(profileId), deps.assignedOutlets);
  const [products, categories, premises] = await Promise.all([
    deps.readProducts(outletId), deps.readCategories(outletId), deps.readPremises(outletId),
  ]);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Products');
  sheet.addRow(PRODUCT_EXCEL_COLUMNS);
  const categoryById = new Map(categories.map(category => [category.id, category]));
  const unique = [...new Map(products.map(product => [product.id, product])).values()]
    .sort((a, b) => text(a.fields.code).localeCompare(text(b.fields.code), 'en', { numeric: true }) || a.id.localeCompare(b.id));
  let premisesSheet: ExcelJS.Worksheet | undefined;
  const notes: string[][] = [];
  for (const { fields: f } of unique) {
    const category = categoryById.get(text(f.category));
    const table = priceTable(f.priceTable);
    const tax = ANDROID_TAX_OPTIONS.find(tax => tax.index === Number(f.taxIndex));
    const unit = PRODUCT_UNITS.find(unit => f.unitId !== undefined && f.unitId !== null && f.unitId !== '' && unit.id === Number(f.unitId));
    if (f.category && !category) notes.push([text(f.name), text(f.code), `Category reference could not be resolved: ${text(f.category)}`]);
    if (f.taxIndex !== undefined && f.taxIndex !== null && f.taxIndex !== '' && !tax) notes.push([text(f.name), text(f.code), `Unknown taxIndex: ${text(f.taxIndex)}`]);
    if (f.unitId !== undefined && f.unitId !== null && f.unitId !== '' && !unit) notes.push([text(f.name), text(f.code), `Unknown unitId: ${text(f.unitId)}`]);
    addRow(sheet, [text(f.name), text(f.regionalName), number(table['default price']), number(f.price), number(f.mrpPrice), number(f.costPrice),
      category?.name ?? '', number(category?.categoryNo), tax?.percent ?? '', text(f.barcode), unit?.name.toLowerCase() ?? '', number(f.currentStock),
      typeof f.weighable === 'boolean' ? f.weighable ? 'YES' : 'NO' : '', text(f.code), text(f.hsnCode)]);
    for (const [key, value] of Object.entries(table)) {
      if (normalize(key) === 'default price') continue;
      if (value !== null && value !== undefined && typeof value !== 'string' && typeof value !== 'number') {
        throw new ProductCreationError(422, 'A product has an invalid premises price. Correct it before exporting so its value is not lost.');
      }
      if (!premisesSheet) {
        premisesSheet = workbook.addWorksheet('Premises');
        premisesSheet.addRow(['Product Row', 'Product Name', 'Search Code', 'Premises', 'Price Key', 'Price']);
      }
      const base = key.trim().replace(/\s+price$/i, '');
      const match = premises.find(premise => normalize(premise.name) === normalize(key))
        ?? premises.find(premise => normalize(premise.name) === normalize(base));
      // Keep every original key, including legacy/unconfigured names and duplicate aliases.
      const price = number(value);
      addRow(premisesSheet, [sheet.rowCount, text(f.name), text(f.code), match?.name ?? base, key, price === '' ? text(value) : price]);
    }
  }
  if (notes.length) {
    const warnings = workbook.addWorksheet('Export Notes');
    warnings.addRow(['Product Name', 'Search Code', 'Unresolved Mapping']);
    notes.forEach(row => addRow(warnings, row));
  }
  for (const tab of workbook.worksheets) {
    tab.views = [{ state: 'frozen', ySplit: 1 }];
    tab.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, tab.rowCount), column: tab.columnCount } };
    tab.columns.forEach(column => { column.width = 22; });
    tab.getRow(1).font = { bold: true, color: { argb: 'FF193454' } };
    tab.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F8FC' } };
  }
  for (const index of [10, 14, 15]) sheet.getColumn(index).numFmt = '@';
  if (premisesSheet) premisesSheet.getColumn(3).numFmt = '@';
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  return { buffer, filename: 'Products.xlsx', count: unique.length, warnings: notes.length };
}
