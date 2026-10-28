import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PRODUCT_COLUMNS, parseProductCsv } from '../src/pages/productCsvPreview.ts';
import { readProductUploadFile } from '../src/pages/productUploadFile.ts';
import ExcelJS from '../node_modules/exceljs/excel.js';
const row = ['Chicken', 'Local', '20', '20', '0', '0', 'Food', '1', '0', '0', 'number', '0', 'no', ''];
const headers = [...PRODUCT_COLUMNS, 'AC Table', 'Non AC Table'];
const source = (names = headers, prices = ['25.50', '0']) => [names, [...row, ...prices]].map(cells => cells.join(',')).join('\n');
test('named premises columns accept separate decimal and zero selling prices', () => {
  const preview = parseProductCsv(source(), 'premises');
  assert.deepEqual(preview.headerErrors, []);
  assert.deepEqual(preview.rows[0].errors, []);
  assert.deepEqual(preview.rows[0].warnings, []);
  assert.deepEqual(preview.rows[0].cells.slice(14), ['25.50', '0']);
  assert.ok(parseProductCsv(source(headers, ['25', '0'])).headerErrors.length, 'standard upload remains strict');
});
test('named premises reject duplicate, reserved, mixed legacy and invalid price columns', () => {
  for (const extras of [['AC Table', ' ac  table '], ['AC Table', 'AC Table price'], ['Default Price', 'Table'], ['Premises 1', 'AC Table'], ['', 'AC Table']]) {
    assert.ok(parseProductCsv(source([...PRODUCT_COLUMNS, ...extras], ['25', '0']), 'premises').headerErrors.length);
  }
  for (const price of ['', '-1', 'NaN', 'Infinity', 'Table']) {
    const preview = parseProductCsv(source(headers, [price, '0']), 'premises');
    assert.ok(preview.rows[0].errors.some(issue => issue.column === 'AC Table'));
  }
});
test('XLSX and TSV accept the same named premises columns and prices', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Products'); sheet.addRow(headers); sheet.addRow([...row, 25.5, 0]);
  const file = new File([await workbook.xlsx.writeBuffer()], 'premises.xlsx');
  const parsed = await readProductUploadFile(file, 'premises');
  assert.deepEqual(parsed.preview.headerErrors, []); assert.deepEqual(parsed.preview.rows[0].errors, []);
  assert.deepEqual(parsed.preview.rows[0].cells.slice(14), ['25.5', '0']);
  const tsv = await readProductUploadFile(new File([source().replaceAll(',', '\t')], 'prices.tsv'), 'premises');
  assert.deepEqual(tsv.preview.rows[0].errors, []);
});
