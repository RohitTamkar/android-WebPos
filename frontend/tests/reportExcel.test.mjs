import { gstDetailRows, loadGstExportBills, gstBillSummary } from '../src/utils/gstExcel.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import ExcelJS from 'exceljs';
import {
  createReportWorkbook, reportFilename, gstSummary, billRange, sumPayments, paymentSummary, salesTaxRows, salesTaxSummary,
  downloadReportExcel,
} from '../src/utils/reportExcel.ts';

const expectedLabels = [
  'Shop Name', 'Date & Time', 'Report Date Range', 'Bill No Range', 'GSTIN',
  'TOTAL SALE', 'TOTAL TAX', 'Cash', 'Digital', 'Credit', 'Card', 'Google Pay',
  'PhonePe', 'Paytm', 'Cheque', 'Other', 'Loyalty Point', '5% Taxable Value',
  '5% Tax Amount', '12% Taxable Value', '12% Tax Amount', '18% Taxable Value',
  '18% Tax Amount', '28% Taxable Value', '28% Tax Amount', '8% Taxable Value', '8% Tax Amount',
];
const expectedGstHeaders = [
  'DATE', 'BILL NO START', 'BILL NO END', 'Total Quantity',
  'Taxable Value(5%)', '2.5% CGST', '2.5% SGST',
  'Taxable Value(12%)', '6% CGST', '6% SGST',
  'Taxable Value(18%)', '9% CGST', '9% SGST',
  'Taxable Value(28%)', '14% CGST', '14% SGST',
  'Taxable Value(8%)', '8% TAX', 'Total Sale',
];
const outlet = { name: 'Test Shop', gstin: 'TEST-GSTIN' };
const appliedFilters = { startDate: '2026-08-01', endDate: '2026-08-31', dayId: '' };
const now = new Date('2026-10-16T06:30:00Z');

async function roundTrip(options) {
  const generated = await createReportWorkbook({ ...options, now });
  const buffer = await generated.xlsx.writeBuffer();
  assert.equal(Buffer.from(buffer).subarray(0, 2).toString(), 'PK', 'xlsx is a ZIP workbook');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  assert.equal(sheet.getCell('A1').value, options.name);
  assert.equal(sheet.getCell('A1').font.bold, true);
  assert.equal(sheet.getCell('A1').font.size, 20);
  assert.equal(sheet.getCell('A1').alignment.horizontal, 'left');
  assert.equal(sheet.getCell('A1').alignment.vertical, 'middle');
  sheet.eachRow(row => row.eachCell(cell => {
    assert.equal(cell.alignment.horizontal, row.number === 1 ? 'left' : row.number <= 28 ? 'center' : 'right');
    if (row.number <= 28) assert.equal(cell.alignment.vertical, 'middle');
  }));
  assert.deepEqual(expectedLabels.map((_, i) => sheet.getCell(i + 2, 1).value), expectedLabels);
  assert.equal(sheet.getCell('B2').value, 'Test Shop');
  assert.equal(sheet.getCell('B3').value.getTime(), now.getTime());
  assert.equal(sheet.getCell('B6').value, 'TEST-GSTIN');
  for (let row = 2; row <= 28; row++) {
    assert.equal(sheet.getCell(row, 2).alignment.horizontal, 'center');
    assert.equal(sheet.getCell(row, 1).alignment.horizontal, 'center');
  }
  for (const row of [29, 30, 31]) assert.equal(sheet.getRow(row).actualCellCount, 0);
  const data = options.rows.slice(options.rows.findIndex(row => row.length));
  data.forEach((row, i) => row.forEach((value, j) => {
    const actual = sheet.getCell(32 + i, 1 + j).value;
    if (value instanceof Date) assert.equal(actual.getTime(), value.getTime());
    else assert.equal(actual, typeof value === 'string' && value.trim().toUpperCase() === 'N/A' ? 0 : value, `detail ${i},${j} survives serialization`);
  }));
  return sheet;
}

// Execute each page's actual export callback with deterministic report state.
// No API/database connection or React rendering is needed for workbook tests.
async function pageExport(page, context) {
  const source = readFileSync(new URL(`../src/pages/${page}ReportPage.tsx`, import.meta.url), 'utf8');
  const ast = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let handler;
  const helpers = [];
  function visit(node) {
    if (ts.isFunctionDeclaration(node)) helpers.push(node.getText(ast));
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'exportExcel') handler = node.initializer.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(handler, `${page} has an export handler`);
  let options;
  const args = {
    outlet, appliedFilters, dayId: '2026-08-15', billRange, gstSummary, sumPayments, paymentSummary, gstDetailRows, gstBillSummary, salesTaxRows, salesTaxSummary,
    token: 'test-token', onSessionExpired() {},
    loadGstExportBills: async (_id, _token, bills) => bills.map(bill => ({ ...gstReport.bills[0], ...bill, gross: bill.finalTotal })),
    setExporting() {}, setError(error) { if (error) throw new Error(error); },
    downloadReportExcel: async value => { options = value; },
    ...context,
  };
  const js = ts.transpileModule(`${helpers.join('\n')}\nconst handler = ${handler};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.None },
  }).outputText;
  await new Function(...Object.keys(args), `${js}\nreturn handler;`)(...Object.values(args))();
  assert.ok(options, `${page} calls the shared Excel writer`);
  return options;
}

const totals = { taxable: 100, cgst: 2.5, sgst: 2.5, igst: 0, gst: 5, gross: 105 };
const gstReport = {
  summary: { ...totals, totalBills: 1, gstBills: 1 },
  rates: [{ ...totals, rate: 5, billCount: 1, itemCount: 2 }],
  bills: [{ ...totals, billNo: '0007', createdDate: 1786755600000, dayId: '2026-08-15', taxType: 'inclusive', rates: [5], finalTotal: 104.75, items: [{ ...totals, rate: 5, quantity: 2 }] }],
};

for (const view of ['rate', 'bill']) {
  for (const range of [appliedFilters, { startDate: '2026-09-01', endDate: '2026-09-01' }]) {
    test(`GST SUMMARY ${view} preserves its detail layout for ${range.startDate}`, async () => {
      const options = await pageExport('Gst', { report: gstReport, view, reportName: 'GST SUMMARY', appliedFilters: range });
      const sheet = await roundTrip(options);
      assert.equal(sheet.getCell('B4').value, `${range.startDate} to ${range.endDate}`);
      assert.equal(sheet.getCell('B5').value, '0007 to 0007');
      assert.equal(sheet.getCell('B7').value, 105);
      assert.equal(sheet.getCell('B8').value, 5);
      assert.equal(sheet.getCell('B19').value, 100);
      assert.equal(sheet.getCell('B20').value, 5);
      assert.equal(sheet.getCell('B21').value, 0);
      assert.equal(sheet.getCell('B9').value, 0);
      assert.equal(sheet.getCell('B18').value, 0);
      assert.equal(sheet.getRow(32).actualCellCount, 19);
      assert.ok(sheet.model.merges.includes('A1:S1'));
      assert.deepEqual(options.rows[0], expectedGstHeaders);
      assert.deepEqual(options.rows[1], ['2026-08-15', '0007', '0007', 2, 100, 2.5, 2.5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 105]);
      assert.equal(sheet.getCell('E33').numFmt, '#,##0.00;[Red]-#,##0.00');
      assert.equal(sheet.getCell('F33').numFmt, '#,##0.00;[Red]-#,##0.00');
      assert.equal(reportFilename(options), `GST_SUMMARY_${range.startDate}_to_${range.endDate}.xlsx`);
    });
  }
}

test('GST day report uses the requested 19-column layout', async () => {
  const options = await pageExport('GstDaywise', { report: gstReport, reportName: 'GST Report Day Wise' });
  const sheet = await roundTrip(options);
  assert.equal(sheet.getCell('B19').value, 100);
  assert.equal(sheet.getCell('A32').value, 'DATE');
  assert.equal(sheet.getRow(32).actualCellCount, 19);
});

test('bill export includes all pages, existing payments, actual taxes and numeric/string/date types', async () => {
  const bill = { billNo: '0009', createdDate: 1786755600000, finalTotal: 105, taxAmount: 5,
    payments: { cash: 20, card: 30, googlepay: 55 }, paymentModes: ['cash', 'card', 'googlepay'],
    billType: 'Sale', shiftId: '01', deviceId: '001', discount: 0 };
  const second = { ...bill, billNo: '0010', createdDate: bill.createdDate + 1000, finalTotal: 12, taxAmount: 2, payments: { credit: 12 } };
  const calls = [];
  const options = await pageExport('BillWise', {
    reportName: 'Bill Wise Sale Report',
    requestReport: async page => {
      calls.push(page);
      return { bills: [page === 1 ? bill : second], summary: { totalAmount: 117, cashTotal: 20, digitalTotal: 85 }, pagination: { totalPages: 2 } };
    },
  });
  const sheet = await roundTrip(options);
  assert.deepEqual(calls, [1, 2]);
  assert.equal(sheet.getCell('B5').value, '0009 to 0010');
  assert.equal(sheet.getCell('B7').value, 117);
  assert.equal(sheet.getCell('B8').value, 7);
  assert.equal(sheet.getCell('B9').value, 20);
  assert.equal(sheet.getCell('B10').value, 85);
  assert.equal(sheet.getCell('B11').value, 12);
  assert.equal(sheet.getCell('B12').value, 30);
  assert.equal(sheet.getCell('B13').value, 55);
  assert.equal(sheet.getCell('B19').value, 200, 'GST slab values come from matched GST items');
  assert.equal(sheet.getCell('B33').value, '0009');
  assert.equal(sheet.getCell('B34').value, '0010');
});

test('product Sale export preserves exact amounts, quantities, codes and selected ordering', async () => {
  const products = [
    { code: '0003', name: '=literal', category: 'Food', billCount: 1, quantity: 2.125, averageRate: 47.0588, amount: 100.123456, share: 75, taxRate: '5%' },
    { code: '0001', name: 'Other', category: 'Food', billCount: 2, quantity: 1, averageRate: 99, amount: -2.45, share: 25, taxRate: '5%, 12%' },
  ];
  const summary = { totalBills: 2, totalQuantity: 3.125, totalAmount: 97.673456 };
  const before = structuredClone(products);
  const options = await pageExport('ProductWise', { reportName: 'Product Wise', report: { summary }, sortedProducts: products });
  const sheet = await roundTrip(options);
  assert.deepEqual(options.rows[0], ['Search Code', 'Product Name', 'Category', 'Tax Rate', 'Qty Sold', 'Sale', 'Tax Amount', 'Discount']);
  assert.equal(sheet.getRow(32).actualCellCount, 8);
  assert.equal(sheet.getCell('A33').value, '0003');
  assert.equal(sheet.getCell('B33').value, '=literal', 'text stays text, never an Excel formula');
  assert.equal(sheet.getCell('D33').value, '5%');
  assert.equal(sheet.getCell('D34').value, 0);
  assert.equal(sheet.getCell('F33').value, products[0].amount);
  assert.equal(sheet.getCell('F34').value, products[1].amount);
  assert.equal(sheet.getCell('F35').value, summary.totalAmount);
  assert.equal(sheet.getCell('B7').value, summary.totalAmount);
  assert.equal(sheet.getCell('E35').value, summary.totalQuantity);
  assert.equal(sheet.getCell('F33').numFmt, '#,##0.00;[Red]-#,##0.00');
  assert.equal(sheet.getCell('G33').value, 0);
  assert.equal(sheet.getCell('B8').value, 0, 'unsupported tax summary remains at the existing default');
  assert.equal(options.startDate, appliedFilters.startDate);
  assert.equal(options.endDate, appliedFilters.endDate);
  assert.deepEqual(products, before);
});

test('category Sale export retains subtotals and labelled product breakdowns without adding them twice', async () => {
  const categories = [{
    categoryId: 'c1', categoryNo: 13, name: 'Food', billCount: 2, productCount: 2,
    quantity: 3.125, amount: 97.673456, share: 100, taxRate: '5%, 12%',
    products: [
      { productId: 'p1', name: 'Meal', quantity: 2.125, amount: 100.123456, taxRate: '5%' },
      { productId: 'p2', name: 'Refund', quantity: 1, amount: -2.45, taxRate: '12%' },
    ],
  }];
  const summary = { totalBills: 2, totalQuantity: 3.125, totalAmount: 97.673456 };
  const before = structuredClone(categories);
  const options = await pageExport('CategoryWise', { reportName: 'Category Wise', report: { summary, categories } });
  const sheet = await roundTrip(options);
  assert.deepEqual(options.rows[0], ['Category No', 'Category Name', 'Tax Rate', 'Total Products', 'Items Sold', 'Sale', 'Tax Amount', 'Discount']);
  assert.equal(sheet.getCell('A33').value, 13);
  assert.equal(sheet.getCell('B33').value, 'Food');
  assert.equal(sheet.getCell('C33').value, 0);
  assert.equal(sheet.getCell('D33').value, 2);
  assert.equal(sheet.getCell('D33').numFmt, '#,##0.###', 'product counts do not use money formatting');
  assert.equal(sheet.getCell('B34').value, 'Meal');
  assert.equal(sheet.getCell('C34').value, '5%');
  assert.equal(sheet.getCell('F33').value, categories[0].amount);
  assert.equal(sheet.getCell('F34').value, categories[0].products[0].amount);
  assert.equal(sheet.getCell('F35').value, categories[0].products[1].amount);
  assert.equal(sheet.getCell('F36').value, summary.totalAmount, 'grand total uses the existing API summary, never subtotal plus children');
  assert.equal(sheet.getCell('B7').value, summary.totalAmount);
  assert.equal(sheet.getCell('E36').value, summary.totalQuantity);
  assert.equal(sheet.getCell('G33').value, 0);
  assert.deepEqual(categories, before);
});

test('category and product exports use zero for unavailable rate, discount and category number', async () => {
  const product = { code: '0003', name: 'Item', category: 'Food', quantity: 1, amount: 25 };
  const summary = { totalBills: 1, totalQuantity: 1, totalAmount: 25 };
  const options = await pageExport('ProductWise', { reportName: 'Product Wise', report: { summary }, sortedProducts: [product] });
  const productSheet = await roundTrip(options);
  assert.equal(productSheet.getCell('D33').value, 0);
  assert.equal(productSheet.getCell('G33').value, 0);
  const categoryOptions = await pageExport('CategoryWise', { reportName: 'Category Wise', report: { summary, categories: [{ name: 'Food', productCount: 1, quantity: 1, amount: 25, products: [product] }] } });
  const categorySheet = await roundTrip(categoryOptions);
  assert.equal(categorySheet.getCell('A33').value, 0);
  assert.equal(categorySheet.getCell('C33').value, 0);
  assert.equal(categorySheet.getCell('C34').value, 0);
  assert.equal(categorySheet.getCell('G34').value, 0);
});

test('empty GST and bill exports retain headers, summaries and three blank rows', async () => {
  const empty = { summary: { taxable: 0, cgst: 0, sgst: 0, igst: 0, gst: 0, gross: 0, totalBills: 0 }, rates: [], bills: [] };
  const options = await pageExport('Gst', { reportName: 'GST Report', report: empty, view: 'rate' });
  const sheet = await roundTrip(options);
  assert.equal(sheet.getCell('A32').value, 'DATE');
  assert.equal(sheet.getCell('B7').value, 0);
  assert.equal(sheet.getCell('B5').value, 0);
  const bills = await pageExport('BillWise', { reportName: 'Bill Wise Sale Report', requestReport: async () => ({ bills: [], summary: { totalAmount: 0, cashTotal: 0, digitalTotal: 0 }, pagination: { totalPages: 0 } }) });
  assert.equal((await roundTrip(bills)).getCell('A32').value, 'DATE');
});

test('stock and inventory exports keep quantities/values without inventing sales totals', async () => {
  const stock = await pageExport('Stock', { reportName: 'Stock Report', rows: [{ code: '009', name: 'Item', category: 'Food', tracked: true, currentStock: 2, reorderLevel: 1, status: 'In stock', price: 50, stockValue: 100 }], summary: { tracked: 1, totalStock: 2, stockValue: 100 } });
  assert.equal((await roundTrip(stock)).getCell('B7').value, 0);
  for (const [page, key] of [['StockTransfer', 'transfers'], ['StockInOut', 'movements']]) {
    const options = await pageExport(page, { reportName: page, report: {
      [key]: [{ transferNo: 'T01', transactionNo: 'M01', dayId: '2026-08-15', createdDate: 1786755600000, type: 'Transfer', direction: 'in', supplier: 'Supplier', finalTotal: 50, remark: '', references: [], items: [] }],
      summary: { totalQuantity: 2, netQuantity: 2, totalAmount: 50 },
    } });
    const sheet = await roundTrip(options);
    assert.equal(sheet.getRow(32).actualCellCount, 14);
    assert.equal(sheet.getCell('B7').value, 0);
  }
});

test('day export omits the removed sections and shift export retains its 18 columns', async () => {
  const day = await pageExport('Daywise', { reportName: 'Day Wise Report', report: { dayId: '2026-08-15', billCount: 1, cashSale: 10, digitalSale: 20, creditSale: 0, expensesAmtTotal: 0, totalSale: 30, tax: 2, billDeletesNumber: 0, payments: { cash: 10, card: 20 } }, bills: [], metrics: [['Total Tax', 2]] });
  const daySheet = await roundTrip(day);
  assert.equal(daySheet.getCell('A32').value, 'DATE');
  assert.equal(daySheet.getCell('B7').value, 30);
  assert.equal(daySheet.getCell('B8').value, 2);
  assert.deepEqual(day.rows[0], expectedGstHeaders);
  assert.equal(daySheet.getRow(32).actualCellCount, 19);
  assert.deepEqual(day.rows.map(row => row[0]), ['DATE', 'Total']);
  const shift = { dayId: '2026-08-15', shiftNo: 1, inActive: false, deviceId: '001', startTime: 1786755600000, endTime: 0, startBillNo: '01', lastBillNo: '03', billCount: 3, openingAmt: 0, cashSale: 10, digitalSale: 20, creditSale: 0, discount: 0, tax: 2, expensesAmtTotal: 0, expCash: 0, totalSale: 30, payments: { cash: 10, card: 20 } };
  const options = await pageExport('ShiftSummary', { reportName: 'Shift Summary Report', report: { shifts: [shift], summary: { totalSale: 30, cashSale: 10, digitalSale: 20, creditSale: 0 } } });
  const sheet = await roundTrip(options);
  assert.equal(sheet.getRow(32).actualCellCount, 18);
  assert.equal(sheet.getCell('B5').value, '01 to 03');
  assert.equal(sheet.getCell('R33').value, 30);
});

test('browser download uses xlsx MIME, filename and a valid workbook', async () => {
  const saved = {};
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  try {
    globalThis.document = { createElement: () => ({ set href(value) { saved.href = value; }, set download(value) { saved.filename = value; }, click() { saved.clicked = true; } }) };
    globalThis.window = { setTimeout(callback) { callback(); } };
    URL.createObjectURL = blob => { saved.blob = blob; return 'blob:test'; };
    URL.revokeObjectURL = url => { saved.revoked = url; };
    await downloadReportExcel({ name: 'GST SUMMARY', outlet, startDate: '2026-08-01', endDate: '2026-08-31', rows: [['Tax', 'Amount']] });
    assert.equal(saved.filename, 'GST_SUMMARY_2026-08-01_to_2026-08-31.xlsx');
    assert.equal(saved.blob.type, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    assert.equal(saved.clicked, true);
    assert.equal(saved.revoked, 'blob:test');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await saved.blob.arrayBuffer());
    assert.equal(workbook.worksheets[0].getCell('A1').value, 'GST SUMMARY');
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  }
});


test('missing top summary values and detail N/A placeholders default to numeric zero', async () => {
  const workbook = await createReportWorkbook({
    name: 'Report', outlet: { name: '' },
    summary: { Cash: '', Digital: '  ', Credit: Number.NaN, Card: 'N/A', 'TOTAL SALE': 123.45 },
    rows: [['Product', 'Amount'], ['N/A', 0]],
  });
  const reloaded = new ExcelJS.Workbook();
  await reloaded.xlsx.load(await workbook.xlsx.writeBuffer());
  const sheet = reloaded.worksheets[0];
  for (const row of [2, 4, 5, 6, 8, 9, 10, 11, 12]) {
    assert.equal(sheet.getCell(row, 2).value, 0);
    assert.equal(sheet.getCell(row, 2).alignment.horizontal, 'center');
  }
  assert.equal(sheet.getCell('B7').value, 123.45);
  assert.equal(sheet.getCell('A33').value, 0);
  assert.equal(sheet.getCell('B33').alignment.horizontal, 'right');
});

test('GST rows aggregate all requested tax bands by day or bill without recalculating tax', async () => {
  const bill = {
    billNo: '0010', dayId: '2026-08-15', createdDate: 20, gross: 168,
    items: [
      { quantity: 1.5, rate: 5, taxable: 10, cgst: 0.2, sgst: 0.3, gst: 0.5 },
      { quantity: 2, rate: 12, taxable: 20, cgst: 1, sgst: 1.4, gst: 2.4 },
      { quantity: 3, rate: 18, taxable: 30, cgst: 0, sgst: 0, gst: 5.4 },
      { quantity: 4, rate: 28, taxable: 40, cgst: 5.6, sgst: 5.6, gst: 11.2 },
      { quantity: 5, rate: 8, taxable: 50, cgst: 2, sgst: 2, gst: 4 },
      { quantity: 6, rate: 0, taxable: 10, cgst: 0, sgst: 0, gst: 0 },
    ],
  };
  const first = { ...bill, billNo: '0009', createdDate: 10, gross: 105, items: [gstReport.bills[0].items[0]] };
  const nextDay = { ...first, billNo: '0011', dayId: '2026-08-16', createdDate: 30 };
  const source = [nextDay, bill, first];
  const before = structuredClone(source);
  const dayRows = gstDetailRows(source, 'day');
  assert.deepEqual(dayRows[0], expectedGstHeaders);
  assert.deepEqual(dayRows[1], ['2026-08-15', '0009', '0010', 23.5, 110, 2.7, 2.8, 20, 1, 1.4, 30, 0, 0, 40, 5.6, 5.6, 50, 4, 273]);
  assert.equal(dayRows[2][0], '2026-08-16');
  assert.equal(dayRows.at(-1)[18], 378);
  assert.equal(dayRows.at(-1)[3], 25.5);
  const billRows = gstDetailRows(source, 'bill');
  assert.equal(billRows.length, 5);
  assert.deepEqual(billRows.slice(1, -1).map(row => row.slice(1, 3)), [['0011', '0011'], ['0010', '0010'], ['0009', '0009']]);
  assert.equal(billRows.at(-1)[18], dayRows.at(-1)[18]);
  assert.deepEqual(source, before, 'source records are unchanged');
  const options = { name: 'GST Report', outlet, rows: dayRows };
  const sheet = await roundTrip(options);
  assert.equal(sheet.getCell('R33').value, 4, '8% TAX uses the actual complete tax amount');
  assert.equal(sheet.getCell('L33').value, 0, 'IGST is never relabelled as CGST');
  assert.equal(sheet.getCell('D33').numFmt, '#,##0.###');
});

test('sales GST lookup preserves selected bill filters and sale totals and handles failures', async () => {
  const originalFetch = globalThis.fetch;
  let expired = 0;
  try {
    globalThis.fetch = async (url, options) => {
      const parsed = new URL(url, 'https://test.local');
      assert.equal(parsed.pathname, '/api/outlets/shop%2F1/reports/gst');
      assert.equal(parsed.searchParams.get('startDate'), '2026-08-01');
      assert.equal(parsed.searchParams.get('endDate'), '2026-08-31');
      assert.equal(options.headers.Authorization, 'Bearer test-token');
      return { ok: true, status: 200, json: async () => ({ data: { bills: [
        { ...gstReport.bills[0], documentId: 'excluded' },
        { ...gstReport.bills[0], documentId: 'selected' },
      ] } }) };
    };
    const result = await loadGstExportBills('shop/1', 'test-token', [{ documentId: 'selected', finalTotal: 104.75 }], '2026-08-01', '2026-08-31', () => { expired++; });
    assert.equal(result.length, 1);
    assert.equal(result[0].documentId, 'selected');
    assert.equal(result[0].gross, 104.75, 'sales report total survives discount and round-off');
    assert.equal(result[0].items[0].taxable, 100);
    await assert.rejects(() => loadGstExportBills('shop/1', 'test-token', [{ documentId: 'missing', finalTotal: 0 }], '2026-08-01', '2026-08-31', () => {}), /GST details are unavailable/);
    globalThis.fetch = async () => { throw new Error('Empty exports must not request GST data'); };
    assert.deepEqual(await loadGstExportBills('shop', 'token', [], '2026-08-01', '2026-08-31', () => {}), []);
    globalThis.fetch = async () => ({ status: 401 });
    await assert.rejects(() => loadGstExportBills('shop', 'token', [{ documentId: 'selected', finalTotal: 0 }], '2026-08-01', '2026-08-31', () => { expired++; }), /session has expired/);
    assert.equal(expired, 1);
    globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({ message: 'Unavailable' }) });
    await assert.rejects(() => loadGstExportBills('shop', 'token', [{ documentId: 'selected', finalTotal: 0 }], '2026-08-01', '2026-08-31', () => {}), /Unavailable/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('day-wise sales export groups selected bills and keeps its existing total sale', async () => {
  const bills = [
    { documentId: 'two', billNo: '0010', createdDate: 20, finalTotal: 104.25, payments: { cash: 104.25 }, taxAmount: 5 },
    { documentId: 'one', billNo: '0009', createdDate: 10, finalTotal: 104.75, payments: { cash: 104.75 }, taxAmount: 5 },
  ];
  let requested = false;
  const options = await pageExport('Daywise', {
    reportName: 'Day Wise Report', bills,
    report: { totalSale: 209, tax: 10, cashSale: 209, digitalSale: 0, creditSale: 0, payments: { cash: 209 } },
    loadGstExportBills: async (id, token, selected, from, to) => {
      requested = true;
      assert.equal(token, 'test-token');
      assert.equal(from, '2026-08-15');
      assert.equal(to, '2026-08-15');
      assert.deepEqual(selected, bills);
      return selected.map(bill => ({ ...gstReport.bills[0], ...bill, gross: bill.finalTotal }));
    },
  });
  assert.equal(requested, true);
  assert.deepEqual(options.rows[1], ['2026-08-15', '0009', '0010', 4, 200, 5, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 209]);
  const sheet = await roundTrip(options);
  assert.equal(sheet.getCell('B7').value, 209);
  assert.equal(sheet.getCell('B19').value, 200);
});

test('empty GST day-wise export retains all 19 columns with zero totals', async () => {
  const options = await pageExport('GstDaywise', {
    reportName: 'GST Report Day Wise',
    report: { bills: [], rates: [], summary: { taxable: 0, cgst: 0, sgst: 0, igst: 0, gst: 0, gross: 0, totalBills: 0 } },
  });
  assert.deepEqual(options.rows[0], expectedGstHeaders);
  assert.deepEqual(options.rows[1], ['Total', '', '', ...Array(16).fill(0)]);
  await roundTrip(options);
});

function splitTaxFixture() {
  const tax = 200 - 200 / 1.05;
  const group = (rate, quantity, amount, taxAmount = 0, productCount = 1) => ({
    rate, quantity, amount, taxAmount, taxableValue: amount - taxAmount, productCount,
  });
  const products = [
    { productId: 'roll', code: '001', name: 'Veg Roll', category: 'VEG ROLLS', quantity: 5, amount: 345,
      taxRate: '0%, 5%', taxBreakdown: [group(0, 2, 145), group(5, 3, 200, tax)] },
    { productId: 'veg-cheese', code: '002', name: 'Veg Cheese Roll', category: 'VEG ROLLS', quantity: 1, amount: 90, taxBreakdown: [group(0, 1, 90)] },
    { productId: 'cheese', code: '003', name: 'Cheese Roll', category: 'VEG ROLLS', quantity: 1, amount: 70, taxBreakdown: [group(0, 1, 70)] },
    { productId: 'egg', code: '004', name: 'Double Egg Roll', category: 'EGG ROLLS', quantity: 1, amount: 70, taxBreakdown: [group(0, 1, 70)] },
  ];
  return {
    tax, products,
    summary: { totalQuantity: 8, totalAmount: 575, totalTax: tax },
    categories: [
      { categoryNo: 1, name: 'VEG ROLLS', quantity: 7, amount: 505, productCount: 3,
        taxBreakdown: [group(0, 4, 305, 0, 3), group(5, 3, 200, tax)], products: products.slice(0, 3) },
      { categoryNo: 2, name: 'EGG ROLLS', quantity: 1, amount: 70, productCount: 1,
        taxBreakdown: [group(0, 1, 70)], products: products.slice(3) },
    ],
  };
}

test('product export splits untaxed and 5% sales into single-rate rows with actual tax amounts', async () => {
  const f = splitTaxFixture();
  const before = structuredClone(f);
  const options = await pageExport('ProductWise', { reportName: 'Product Wise', report: { summary: f.summary }, sortedProducts: f.products });
  const sheet = await roundTrip(options);
  assert.equal(sheet.getRow(32).actualCellCount, 8);
  assert.equal(sheet.getCell('G32').value, 'Tax Amount');
  assert.equal(sheet.getCell('D33').value, '0%');
  assert.equal(sheet.getCell('F33').value, 145);
  assert.equal(sheet.getCell('G33').value, 0);
  assert.equal(sheet.getCell('D34').value, '5%');
  assert.equal(sheet.getCell('F34').value, 200);
  assert.equal(sheet.getCell('G34').value, f.tax);
  assert.equal(sheet.getCell('G34').numFmt, '#,##0.00;[Red]-#,##0.00');
  assert.equal(sheet.getCell('E38').value, 8);
  assert.equal(sheet.getCell('F38').value, 575);
  assert.equal(sheet.getCell('G38').value, f.tax);
  assert.equal(sheet.getCell('B7').value, 575);
  assert.equal(sheet.getCell('B8').value, f.tax);
  assert.equal(sheet.getCell('B19').value, 200 - f.tax);
  assert.equal(sheet.getCell('B20').value, f.tax);
  assert.ok(options.rows.slice(1).every(row => !String(row[3]).includes(',')));
  assert.equal(options.rows.slice(1, -1).reduce((sum, row) => sum + row[5], 0), f.summary.totalAmount);
  assert.deepEqual(f, before);
});

test('category export splits category and product amounts by rate without doubling tax or Sale totals', async () => {
  const f = splitTaxFixture();
  const before = structuredClone(f);
  const options = await pageExport('CategoryWise', { reportName: 'Category Wise', report: { summary: f.summary, categories: f.categories } });
  const sheet = await roundTrip(options);
  const details = options.rows.slice(1, -1);
  const categoryRows = details.filter(row => row[0] !== '');
  const productRows = details.filter(row => row[0] === '');
  assert.deepEqual(categoryRows.map(row => [row[1], row[2], row[4], row[5], row[6]]), [
    ['VEG ROLLS', '0%', 4, 305, 0], ['VEG ROLLS', '5%', 3, 200, f.tax], ['EGG ROLLS', '0%', 1, 70, 0],
  ]);
  assert.deepEqual(productRows.filter(row => row[1] === 'Veg Roll').map(row => [row[2], row[4], row[5], row[6]]), [['0%', 2, 145, 0], ['5%', 3, 200, f.tax]]);
  for (const rows of [categoryRows, productRows]) {
    assert.equal(rows.reduce((sum, row) => sum + row[5], 0), 575);
    assert.equal(rows.reduce((sum, row) => sum + row[6], 0), f.tax);
  }
  assert.deepEqual(options.rows.at(-1), ['Total', '', '', '', 8, 575, f.tax, 0]);
  assert.equal(sheet.getCell('B8').value, f.tax);
  assert.equal(sheet.getCell('B20').value, f.tax, 'summary uses category groups once, not their child rows again');
  assert.ok(details.every(row => !String(row[2]).includes(',')));
  assert.ok(details.every(row => !String(row[1]).includes('↳')));
  assert.deepEqual(f, before);
});
