import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const serverSource = readFileSync(new URL('../../backend/src/server.ts', import.meta.url), 'utf8');
const daywiseSummarySource = readFileSync(new URL('../../backend/src/daywiseSummary.ts', import.meta.url), 'utf8');

export async function dashboardResponse(outletId, query, store, profile = { active: true, outlets: ['outlet-1', 'outlet-2'] }) {
  const ast = ts.createSourceFile('server.ts', serverSource, ts.ScriptTarget.Latest, true);
  const helperNames = new Set(['stringValue', 'numberValue', 'assignedOutletIds', 'datesBetween', 'parsePayment']);
  const helpers = ast.statements.filter(node => ts.isFunctionDeclaration(node) && helperNames.has(node.name?.text)).map(node => node.getText(ast));
  const route = ast.statements.find(node => ts.isExpressionStatement(node)
    && ts.isCallExpression(node.expression)
    && node.expression.expression.getText(ast) === 'app.get'
    && node.expression.arguments[0]?.text === '/api/outlets/:outletId/dashboard');
  assert.ok(route, 'dashboard route must exist in server.ts');

  const summaryAst = ts.createSourceFile('daywiseSummary.ts', daywiseSummarySource, ts.ScriptTarget.Latest, true);
  const summaryCode = summaryAst.statements.map(node => node.getText(summaryAst)).join('\n');

  const reads = [];
  const writes = [];

  class Reference {
    constructor(path, filters = []) { this.path = path; this.filters = filters; }
    collection(name) { return new Reference(`${this.path}/${name}`); }
    doc(id) { return new Reference(`${this.path}/${id}`); }
    where(field, operator, value) {
      assert.equal(operator, '==');
      return new Reference(this.path, [...this.filters, [field, value]]);
    }
    async get() {
      reads.push({ path: this.path, filters: this.filters });
      if (this.path === 'USER_PROFILE/user') return { exists: true, data: () => profile };
      if (!Object.hasOwn(store, this.path)) {
        return { empty: true, docs: [] };
      }
      const matched = store[this.path].filter(record =>
        this.filters.every(([key, value]) => record[key] === value)
      );
      return {
        empty: matched.length === 0,
        docs: matched.map(record => ({ id: record.id, data: () => record }))
      };
    }
    // Any write operation will immediately fail the test to guarantee read-only execution
    async set() { writes.push('set'); throw new Error('Illegal database write: set'); }
    async update() { writes.push('update'); throw new Error('Illegal database write: update'); }
    async delete() { writes.push('delete'); throw new Error('Illegal database write: delete'); }
    async add() { writes.push('add'); throw new Error('Illegal database write: add'); }
  }

  const initialStore = structuredClone(store);
  const db = { collection: name => new Reference(name) };

  const summaryClean = summaryCode.replace(/export\s+/g, '');

  const transpiledHelpers = ts.transpileModule(`${summaryClean}\n${helpers.join('\n')}\nconst handler = ${route.expression.arguments[1].getText(ast)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.None },
  }).outputText;

  const handler = new Function('getFirestoreDb', 'readAccessToken', `${transpiledHelpers}\nreturn handler;`)(
    () => db,
    () => ({ profileDocId: 'user' })
  );

  let result;
  let status = 200;
  const res = {
    status(code) { status = code; return this; },
    json(value) { result = value; },
  };

  await handler({ params: { outletId }, query }, res);
  assert.equal(writes.length, 0, 'No database writes may be performed');
  assert.deepEqual(store, initialStore, 'Database store must not be mutated');
  return { status, body: result, reads };
}

const mockShift = (id, shiftNo, dayId, extra = {}) => ({
  id,
  shiftNo,
  dayId,
  deviceId: 'device-1',
  inActive: false,
  startTime: 1791800000000 + (shiftNo * 3600000),
  endTime: 0,
  startBillNo: `B${shiftNo}01`,
  lastBillNo: `B${shiftNo}05`,
  lastBillTime: 1791803600000 + (shiftNo * 3600000),
  billCount: 5,
  billDeletesNumber: 0,
  billDeletesAmount: 0,
  openingAmt: shiftNo === 1 ? 500 : 0,
  totalSale: 1000 * shiftNo,
  cashSale: 600 * shiftNo,
  digitalSale: 400 * shiftNo,
  creditSale: 0,
  subTotalBill: 950 * shiftNo,
  discount: 50 * shiftNo,
  tax: 50 * shiftNo,
  gstTotal: 50 * shiftNo,
  vatTotal: 0,
  refundAmount: 0,
  extraCharges: 0,
  serviceChargeAmount: 0,
  roundOff: 0,
  expensesAmtTotal: 100 * shiftNo,
  expCash: 100 * shiftNo,
  expDigital: 0,
  advanceAmtTotal: 0,
  customerReceiveAmtTotal: 0,
  receiveAmtTotal: 0,
  swiggyTotal: 0,
  zomatoTotal: 0,
  paymentJson: JSON.stringify({ cash: 600 * shiftNo, googlepay: 400 * shiftNo }),
  ...extra,
});

test('Check 1 & 2: Shift 1 bills/metrics remain visible after Shift 1 ends, and Shift 2 appears separately', async () => {
  const shift1 = mockShift('shift-1', 1, '2026-10-19', { inActive: true, endTime: 1791807200000, totalSale: 1000, billCount: 5 });
  const shift2 = mockShift('shift-2', 2, '2026-10-19', { inActive: false, totalSale: 2000, billCount: 8, startBillNo: 'B201', lastBillNo: 'B208' });

  const store = {
    'OUTLET/outlet-1/SHIFT': [shift1, shift2],
  };

  const { status, body } = await dashboardResponse('outlet-1', { dayId: '2026-10-19' }, store);
  assert.equal(status, 200);
  assert.equal(body.success, true);
  assert.ok(body.data, 'Dashboard data returned');

  // Both shifts must be present separately in the shifts array
  assert.equal(body.data.shifts.length, 2, 'Both Shift 1 and Shift 2 are present');
  const [s1, s2] = body.data.shifts;

  // Shift 1 metrics remain intact and visible
  assert.equal(s1.id, 'shift-1');
  assert.equal(s1.shiftNo, 1);
  assert.equal(s1.inActive, true, 'Shift 1 is closed');
  assert.equal(s1.billCount, 5, 'Shift 1 bills remain visible');
  assert.equal(s1.totalSale, 1000, 'Shift 1 sales remain visible');
  assert.equal(s1.cashSale, 600);

  // Shift 2 metrics appear separately
  assert.equal(s2.id, 'shift-2');
  assert.equal(s2.shiftNo, 2);
  assert.equal(s2.inActive, false, 'Shift 2 is active');
  assert.equal(s2.billCount, 8, 'Shift 2 bills are counted separately');
  assert.equal(s2.totalSale, 2000, 'Shift 2 sales appear separately');
  assert.equal(s2.cashSale, 1200);
});

test('Check 3: Overall totals include both shifts combined without double-counting', async () => {
  const shift1 = mockShift('shift-1', 1, '2026-10-19', { inActive: true, totalSale: 1000, cashSale: 600, digitalSale: 400, billCount: 5, discount: 50, tax: 50, expensesAmtTotal: 100, expCash: 100, openingAmt: 500, paymentJson: JSON.stringify({ cash: 600, googlepay: 400 }) });
  const shift2 = mockShift('shift-2', 2, '2026-10-19', { inActive: false, totalSale: 2500, cashSale: 1500, digitalSale: 1000, billCount: 10, discount: 100, tax: 125, expensesAmtTotal: 200, expCash: 150, openingAmt: 0, paymentJson: JSON.stringify({ cash: 1500, googlepay: 1000 }) });

  const store = {
    'OUTLET/outlet-1/SHIFT': [shift1, shift2],
  };

  const { body } = await dashboardResponse('outlet-1', { dayId: '2026-10-19' }, store);
  const data = body.data;

  // Combined totals without double counting:
  assert.equal(data.billCount, 15, '5 + 10 bills');
  assert.equal(data.totalSale, 3500, '1000 + 2500 sales');
  assert.equal(data.cashSale, 2100, '600 + 1500 cash sales');
  assert.equal(data.digitalSale, 1400, '400 + 1000 digital sales');
  assert.equal(data.discount, 150, '50 + 100 discount');
  assert.equal(data.tax, 175, '50 + 125 tax');
  assert.equal(data.expensesAmtTotal, 300, '100 + 200 expenses');
  assert.equal(data.expCash, 250, '100 + 150 cash expenses');
  // Opening balance carries forward from the first shift of the day
  assert.equal(data.openingAmt, 500);
  // Payments aggregation across shifts
  assert.equal(data.payments.cash, 2100);
  assert.equal(data.payments.googlepay, 1400);
  // First and last bill range across shifts
  assert.equal(data.startBillNo, 'B101');
  assert.equal(data.lastBillNo, 'B205');
  // Day is active because Shift 2 is active
  assert.equal(data.inActive, false);
});

test('Check 4: Additional shifts (3 or more) appear dynamically', async () => {
  const shift1 = mockShift('shift-1', 1, '2026-10-19', { inActive: true, totalSale: 100, billCount: 1 });
  const shift2 = mockShift('shift-2', 2, '2026-10-19', { inActive: true, totalSale: 200, billCount: 2 });
  const shift3 = mockShift('shift-3', 3, '2026-10-19', { inActive: true, totalSale: 300, billCount: 3 });
  const shift4 = mockShift('shift-4', 4, '2026-10-19', { inActive: false, totalSale: 400, billCount: 4 });

  const store = {
    'OUTLET/outlet-1/SHIFT': [shift1, shift2, shift3, shift4],
  };

  const { body } = await dashboardResponse('outlet-1', { dayId: '2026-10-19' }, store);
  assert.equal(body.data.shifts.length, 4, 'All 4 shifts dynamically returned');
  assert.deepEqual(body.data.shifts.map(s => s.shiftNo), [1, 2, 3, 4]);
  assert.equal(body.data.billCount, 10, '1 + 2 + 3 + 4 bills');
  assert.equal(body.data.totalSale, 1000, '100 + 200 + 300 + 400 total sale');
});

test('Check 5: Data from other outlets is excluded and authorization is preserved', async () => {
  const shiftOutlet1 = mockShift('shift-o1', 1, '2026-10-19', { totalSale: 500 });
  const shiftOutlet2 = mockShift('shift-o2', 1, '2026-10-19', { totalSale: 9999 });

  const store = {
    'OUTLET/outlet-1/SHIFT': [shiftOutlet1],
    'OUTLET/outlet-2/SHIFT': [shiftOutlet2],
  };

  const { status, body, reads } = await dashboardResponse('outlet-1', { dayId: '2026-10-19' }, store);
  assert.equal(status, 200);
  assert.equal(body.data.totalSale, 500, 'Only outlet-1 data is included');
  assert.ok(reads.every(r => !r.path.includes('outlet-2')), 'No reads to outlet-2');

  // Unauthorized outlet returns 403
  const unauthorized = await dashboardResponse('outlet-unauthorized', { dayId: '2026-10-19' }, store, { active: true, outlets: ['outlet-1'] });
  assert.equal(unauthorized.status, 403);
});

test('Check 6: Different business dates remain separate', async () => {
  const shiftToday = mockShift('shift-today', 1, '2026-10-19', { totalSale: 800 });
  const shiftYesterday = mockShift('shift-yesterday', 1, '2026-10-18', { totalSale: 1200 });

  const store = {
    'OUTLET/outlet-1/SHIFT': [shiftToday, shiftYesterday],
  };

  const { body } = await dashboardResponse('outlet-1', { dayId: '2026-10-19' }, store);
  assert.equal(body.data.totalSale, 800, 'Only 2026-10-19 shifts are included');
  assert.equal(body.data.shifts.length, 1);
  assert.equal(body.data.shifts[0].id, 'shift-today');
});

test('Check 7: Reused shift numbers and multiple devices do not mix unrelated records', async () => {
  // Device A runs Shift 1; Device B also runs Shift 1 (same shiftNo, different deviceId and docId)
  const shiftDevA = mockShift('doc-shift-1-devA', 1, '2026-10-19', { deviceId: 'POS-Counter-1', startTime: 1000, totalSale: 400, billCount: 2 });
  const shiftDevB = mockShift('doc-shift-1-devB', 1, '2026-10-19', { deviceId: 'POS-Counter-2', startTime: 2000, totalSale: 600, billCount: 3 });

  const store = {
    'OUTLET/outlet-1/SHIFT': [shiftDevA, shiftDevB],
  };

  const { body } = await dashboardResponse('outlet-1', { dayId: '2026-10-19' }, store);
  assert.equal(body.data.shifts.length, 2);
  assert.equal(body.data.shifts[0].id, 'doc-shift-1-devA');
  assert.equal(body.data.shifts[0].deviceId, 'POS-Counter-1');
  assert.equal(body.data.shifts[1].id, 'doc-shift-1-devB');
  assert.equal(body.data.shifts[1].deviceId, 'POS-Counter-2');

  assert.equal(body.data.totalSale, 1000, 'Both devices are combined: 400 + 600');
  assert.equal(body.data.billCount, 5, 'Both devices are combined: 2 + 3 bills');
});

test('Check 8: Absolute rule: No database write operations are executed', async () => {
  const shift = mockShift('shift-1', 1, '2026-10-19');
  const store = { 'OUTLET/outlet-1/SHIFT': [shift] };

  const { status, body } = await dashboardResponse('outlet-1', { dayId: '2026-10-19' }, store);
  assert.equal(status, 200);
  assert.ok(body.data);
  // Our Reference mock throws if any write (set/update/delete/add) is called, which would fail the test.
  // We also assert deepEqual on the store.
  assert.deepEqual(store['OUTLET/outlet-1/SHIFT'], [shift]);
});
