import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { PRODUCT_COLUMNS, PREMISES_PRODUCT_COLUMNS, PREMISES_TEMPLATE_COLUMNS, parseProductCsv, fileSelectionError, MAX_FILE_BYTES } from '../src/pages/productCsvPreview.ts';
import { createProductUploadTemplate, productTemplateFilename } from '../src/utils/productUploadTemplate.ts';
import { readProductUploadFile } from '../src/pages/productUploadFile.ts';

const row = ['Product', 'Local', '20', '20', '0', '0', 'Food', '1', '0', '0001', 'number', '0', 'no', ''];
const csv = (rows, headers = PREMISES_PRODUCT_COLUMNS) => [headers, ...rows].map(cells => cells.map(cell => `"${cell.replaceAll('"', '""')}"`).join(',')).join('\n');
const names = ['Main Branch', 'Ground Floor', 'First Floor', 'Warehouse', 'Other Branch'];

test('templates are genuine header-only XLSX workbooks with exact names and column order', async () => {
  for (const [mode, headers, filename] of [
    ['standard', PRODUCT_COLUMNS, 'Product_Upload_Demo.xlsx'],
    ['premises', PREMISES_TEMPLATE_COLUMNS, 'Premises_Wise_Product_Upload_Demo.xlsx'],
  ]) {
    const workbook = await createProductUploadTemplate(mode);
    const buffer = await workbook.xlsx.writeBuffer();
    assert.equal(Buffer.from(buffer).subarray(0, 2).toString(), 'PK');
    const loaded = new ExcelJS.Workbook(); await loaded.xlsx.load(buffer);
    assert.equal(loaded.worksheets.length, 1);
    const sheet = loaded.worksheets[0];
    assert.equal(sheet.rowCount, 1);
    assert.equal(sheet.columnCount, headers.length);
    assert.deepEqual(sheet.getRow(1).values.slice(1), [...headers]);
    assert.equal(productTemplateFilename(mode), filename);
  }
});

test('standard 14-column contract remains separate from premises mode', () => {
  assert.deepEqual(parseProductCsv(csv([row], PRODUCT_COLUMNS)).headerErrors, []);
  const missing = parseProductCsv(csv([row], PRODUCT_COLUMNS), 'premises');
  assert.ok(missing.headerErrors.some(message => /Premises/.test(message)));
  assert.ok(parseProductCsv(csv([[...row, 'MainBranch']])).headerErrors.length);
  assert.equal(fileSelectionError('products.xlsx', 100), 'Select a CSV (.csv) or tab-separated (.tsv) file. XLS and XLSX are not supported in this phase.');
  assert.equal(fileSelectionError('products.xlsx', 100, 'premises'), null);
  assert.ok(fileSelectionError('products.xlsx', MAX_FILE_BYTES + 1, 'premises'));
  assert.ok(fileSelectionError('products.xls', 100, 'premises'));
});

test('premises header must be present, last and unique; rows cannot silently lose extra cells', () => {
  for (const headers of [
    [...PRODUCT_COLUMNS, ''],
    ['Premises', ...PRODUCT_COLUMNS], [...PREMISES_PRODUCT_COLUMNS, 'Extra'],
    [...PRODUCT_COLUMNS, 'Premises', 'Premises'],
  ]) assert.ok(parseProductCsv(csv([[...row, 'Main Branch']], headers), 'premises').headerErrors.length);
  const named = parseProductCsv(csv([[...row, 'Main Branch']], [...PRODUCT_COLUMNS, 'Location']), 'premises');
  assert.deepEqual(named.headerErrors, []);
  assert.ok(named.rows[0].errors.some(issue => issue.column === 'Location'), 'named columns contain prices, not premises names');
  const extra = parseProductCsv(csv([[...row, 'Main Branch', 'extra']]), 'premises');
  assert.ok(extra.rows[0].errors.some(issue => issue.column === 'Row structure'));
  assert.equal(extra.rows[0].cells[15], 'extra');
});

test('five distinct premises and repeated premises retain every row with explicit unverified status', () => {
  const rows = [...names, names[0]].map((name, index) => [...row.map((value, col) => col === 0 ? `Product ${index}` : value), name]);
  const preview = parseProductCsv(csv(rows), 'premises');
  assert.deepEqual(preview.headerErrors, []);
  assert.equal(preview.rows.length, 6);
  assert.deepEqual(preview.rows.map(row => row.cells[14]), [...names, names[0]]);
  assert.ok(preview.rows.every(row => !row.errors.length && row.warnings.some(issue => /Cannot verify premises/.test(issue.message))));
});

test('missing premises and ordinary product field failures identify their row and column', () => {
  const rows = [[...row, 'Ground Floor'], [...row, '  ']];
  rows[0][2] = 'notnumeric'; rows[0][10] = 'kg'; rows[0][11] = '1'; rows[0][12] = '';
  const preview = parseProductCsv(csv(rows), 'premises');
  assert.equal(preview.rows[1].rowNumber, 3);
  assert.ok(preview.rows[1].errors.some(issue => issue.column === 'Premises'));
  for (const column of ['Default Price', 'Price 1', 'Unit Type', 'Stock', 'Weightable']) {
    assert.ok(preview.rows[0].errors.some(issue => issue.column === column), column);
  }
});

test('XLSX premises preview preserves all 17 values and rejects unsupported cell objects', async () => {
  const workbook = await createProductUploadTemplate('premises');
  const sheet = workbook.worksheets[0];
  for (let index = 0; index < names.length; index++) sheet.addRow([...row, String(20 + index), '25.50', '30']);
  const makeFile = async () => new File([new Uint8Array(await workbook.xlsx.writeBuffer())], 'premises.xlsx');
  const result = await readProductUploadFile(await makeFile(), 'premises');
  assert.deepEqual(result.preview.rows.map(row => row.cells[14]), names.map((_, index) => String(20 + index)));
  assert.ok(result.preview.rows.every(row => row.cells[15] === '25.50' && row.cells[16] === '30' && !row.errors.length));
  assert.ok(result.preview.rows.every(row => row.cells.length === 17));
  sheet.getCell('C2').value = { formula: '1+1', result: 2 };
  await assert.rejects(readProductUploadFile(await makeFile(), 'premises'), /Row 2, column 3.*formulas/);
});

test('XLSX preview rejects missing premises headers and multiple nonempty sheets', async () => {
  const workbook = await createProductUploadTemplate('standard');
  workbook.worksheets[0].addRow(row);
  const file = async () => new File([new Uint8Array(await workbook.xlsx.writeBuffer())], 'premises.xlsx');
  const preview = (await readProductUploadFile(await file(), 'premises')).preview;
  assert.ok(preview.headerErrors.some(error => /Premises/.test(error)));
  workbook.addWorksheet('Other').addRow(['Unexpected']);
  await assert.rejects(readProductUploadFile(await file(), 'premises'), /exactly one nonempty worksheet/);
});


test('two, three and five numbered premises-price columns preserve prices and the 14 base fields', () => {
  for (const count of [2, 3, 5]) {
    const headers = [...PRODUCT_COLUMNS, ...Array.from({ length: count }, (_, index) => `Premises ${index + 1}`)];
    const prices = Array.from({ length: count }, (_, index) => index === 0 ? '0' : `${20 + index}.50`);
    const preview = parseProductCsv(csv([[...row, ...prices]], headers), 'premises');
    assert.deepEqual(preview.headerErrors, []);
    assert.deepEqual(preview.rows[0].errors, []);
    assert.deepEqual(preview.rows[0].cells.slice(0, 14), row);
    assert.deepEqual(preview.rows[0].cells.slice(14), prices);
    assert.equal(preview.rows[0].warnings.filter(issue => /^Premises/.test(issue.column)).length, count);
  }
});

test('premises-price columns reject blank, negative, invalid and missing prices, bad numbering and names', () => {
  const headers = [...PRODUCT_COLUMNS, 'Premises 1', 'Premises 2', 'Premises 3'];
  for (const price of ['', '-1', 'NaN', 'Main Branch']) {
    const preview = parseProductCsv(csv([[...row, '20', price, '30']], headers), 'premises');
    assert.ok(preview.rows[0].errors.some(issue => issue.column === 'Premises 2'));
    assert.equal(preview.rows[0].rowNumber, 2);
  }
  for (const extra of [['Premises 1', 'Premises 3'], ['Premises 2', 'Premises 1'], ['Premises 1', 'Premises 1'], ['Premises 1', 'Unknown']]) {
    assert.ok(parseProductCsv(csv([[...row, '20', '30']], [...PRODUCT_COLUMNS, ...extra]), 'premises').headerErrors.length);
  }
  const aliases = [...PRODUCT_COLUMNS, ' premise1 ', 'PREMISES  2'];
  assert.deepEqual(parseProductCsv(csv([[...row, '20', '30']], aliases), 'premises').headerErrors, []);
});
