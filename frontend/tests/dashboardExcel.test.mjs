import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { createDashboardWorkbook, downloadDashboardExcel } from '../src/utils/dashboardExcel.ts';

const data = {
  id: 'shift-id', dayId: '2026-10-13', shiftNo: 3, inActive: false,
  startTime: 1791849600000, endTime: 0, lastBillTime: 1791860400000,
  startBillNo: '001', lastBillNo: '005', billCount: 5, billDeletesNumber: 1, billDeletesAmount: 50,
  openingAmt: 100, totalSale: 516.25, cashSale: 400, digitalSale: 116.25, creditSale: 10,
  subTotalBill: 500, discount: 5, tax: 21.25, gstTotal: 20, vatTotal: 1.25, refundAmount: 2,
  extraCharges: 3, serviceChargeAmount: 4, roundOff: -0.25,
  expensesAmtTotal: 40, expCash: 30, expDigital: 10, advanceAmtTotal: 11,
  customerReceiveAmtTotal: 12, receiveAmtTotal: 23, swiggyTotal: 14, zomatoTotal: 15,
  payments: { cash: 400, googlepay: 100, phonepe: 10, paytm: 6.25, credit: 10, customMode: 7 },
};
const options = { outlet: { name: 'Rohit Testing', branch: 'Pune' }, dayId: data.dayId,
  cashier: 'Test Cashier', terminal: 'POS Workspace', data, now: new Date('2026-10-17T10:00:00Z') };
const values = sheet => {
  const rows = new Map();
  sheet.eachRow(row => { rows.set(row.getCell(1).value, row.getCell(2).value); });
  return rows;
};

test('dashboard workbook has the outlet heading, selected day, context and actual dashboard metrics', async () => {
  const workbook = await createDashboardWorkbook(options);
  const sheet = workbook.worksheets[0]; const cells = values(sheet);
  assert.equal(sheet.getCell('A1').value, 'Rohit Testing');
  assert.equal(sheet.getCell('A2').value, 'Retail POS Dashboard');
  assert.equal(cells.get('Report Date'), data.dayId);
  assert.equal(cells.get('Cashier'), options.cashier);
  assert.equal(cells.get('Branch'), 'Pune');
  assert.equal(cells.get('Terminal'), 'POS Workspace');
  assert.equal(cells.get('Scope'), 'Shift 3 for the selected date');
  assert.equal(cells.get('Cash In Hand'), 470);
  assert.equal(cells.get('Total Sale'), 516.25);
  assert.equal(cells.get('Total Digital Sale'), 116.25);
  assert.equal(cells.get('Cash'), 400); assert.equal(cells.get('Credit'), 10);
  assert.equal(cells.get('customMode'), 7);
  assert.equal(cells.get('No. of Bills'), 5);
  assert.equal(cells.get('GST'), 20); assert.equal(cells.get('VAT'), 1.25);
  assert.equal(cells.get('Round Off'), -0.25);
  assert.equal(cells.get('Deleted Bills'), 1); assert.equal(cells.get('Deleted Bill Amount'), 50);
  assert.equal(cells.get('Total Expenses'), 40); assert.equal(cells.get('Received Customer Credit'), 12);
  assert.equal(cells.get('Swiggy'), 14); assert.equal(cells.get('Zomato'), 15);
  assert.equal(cells.get('First Bill No.'), '001'); assert.equal(cells.get('Status'), 'Active');
  assert.equal(cells.get('End Time'), '—');
  assert.ok(cells.get('Start Time') instanceof Date);
  assert.deepEqual(data.payments, options.data.payments);
});

test('payment fallback matches the dashboard, including explicit zero values', async () => {
  const workbook = await createDashboardWorkbook({ ...options, data: { ...data, payments: { cash: 0 } } });
  const cells = values(workbook.worksheets[0]);
  assert.equal(cells.get('Cash'), 0); assert.equal(cells.get('Credit'), data.creditSale);
  assert.equal(cells.get('Google Pay'), 0);
  await assert.rejects(createDashboardWorkbook({ ...options, dayId: '2026-10-14' }), /does not match/);
});

test('generated XLSX round-trips with numeric amounts, integer counts and dates intact', async () => {
  const workbook = await createDashboardWorkbook(options);
  const buffer = await workbook.xlsx.writeBuffer();
  assert.equal(Buffer.from(buffer).subarray(0, 2).toString(), 'PK');
  const loaded = new ExcelJS.Workbook(); await loaded.xlsx.load(buffer);
  const sheet = loaded.worksheets[0]; const cells = values(sheet);
  assert.equal(cells.get('Total Sale'), 516.25);
  assert.equal(cells.get('No. of Bills'), 5);
  assert.equal(cells.get('First Bill No.'), '001');
  assert.equal(cells.get('Exported At').getTime(), options.now.getTime());
  sheet.eachRow(row => {
    if (row.getCell(1).value === 'Total Sale') assert.equal(row.getCell(2).numFmt, '#,##0.00;[Red]-#,##0.00');
    if (row.getCell(1).value === 'No. of Bills') assert.equal(row.getCell(2).numFmt, '#,##0');
  });
});

test('download uses the selected outlet and date in the filename and produces XLSX bytes', async () => {
  const originals = { document: globalThis.document, window: globalThis.window, create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  let blob; let download; let revoked;
  try {
    URL.createObjectURL = value => { blob = value; return 'blob:dashboard'; };
    URL.revokeObjectURL = value => { revoked = value; };
    globalThis.document = { createElement: () => ({ href: '', download: '', click() { download = this.download; } }) };
    globalThis.window = { setTimeout: fn => fn() };
    await downloadDashboardExcel(options);
    assert.equal(download, 'Rohit_Testing_Dashboard_2026-10-13.xlsx');
    assert.equal(blob.type, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const loaded = new ExcelJS.Workbook(); await loaded.xlsx.load(await blob.arrayBuffer());
    assert.equal(loaded.worksheets[0].getCell('A1').value, 'Rohit Testing');
    assert.equal(revoked, 'blob:dashboard');
  } finally {
    URL.createObjectURL = originals.create; URL.revokeObjectURL = originals.revoke;
    if (originals.document === undefined) delete globalThis.document; else globalThis.document = originals.document;
    if (originals.window === undefined) delete globalThis.window; else globalThis.window = originals.window;
  }
});
