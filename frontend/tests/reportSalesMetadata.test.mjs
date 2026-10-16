import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const serverSource = readFileSync(new URL('../../backend/src/server.ts', import.meta.url), 'utf8');

// Extract the real handlers without starting Express, loading credentials or
// contacting Firebase. The fixture provides read-only Firestore-shaped objects.
export async function reportResponse(kind, query, bills, source = serverSource) {
  const ast = ts.createSourceFile('server.ts', source, ts.ScriptTarget.Latest, true);
  const helperNames = new Set(['stringValue', 'numberValue', 'assignedOutletIds', 'datesBetween', 'historicalReportTaxRate', 'reportTaxRateLabel', 'addReportTaxGroup', 'reportTaxBreakdown', 'reportTaxAmount']);
  const helpers = ast.statements.filter(node => ts.isFunctionDeclaration(node) && helperNames.has(node.name?.text)).map(node => node.getText(ast));
  const route = ast.statements.find(node => ts.isExpressionStatement(node)
    && ts.isCallExpression(node.expression)
    && node.expression.expression.getText(ast) === 'app.get'
    && node.expression.arguments[0]?.text === `/api/outlets/:outletId/reports/${kind}`);
  assert.ok(route);
  const records = {
    'OUTLET/outlet/CATEGORY': [{ id: 'c1', name: 'Food', categoryNo: 13 }, { id: 'c2', name: 'Drinks' }],
    'OUTLET/outlet/PRODUCT': [{ id: 'p1', code: '0003', price: 999, discount: 50, taxPercentage: 28 }],
    'OUTLET/outlet/BILL_SALE_SUMMARY': bills,
  };
  const reads = [];
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
      if (this.path === 'USER_PROFILE/user') return { exists: true, data: () => ({ active: true, outlets: ['outlet'] }) };
      assert.ok(Object.hasOwn(records, this.path), `unexpected read: ${this.path}`);
      return { docs: records[this.path].filter(record => this.filters.every(([key, value]) => record[key] === value))
        .map(record => ({ id: record.id, data: () => record })) };
    }
  }
  const before = structuredClone(records);
  const db = { collection: name => new Reference(name) };
  const js = ts.transpileModule(`${helpers.join('\n')}\nconst handler = ${route.expression.arguments[1].getText(ast)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.None },
  }).outputText;
  const handler = new Function('getFirestoreDb', 'readAccessToken', `${js}\nreturn handler;`)(() => db, () => ({ profileDocId: 'user' }));
  let result;
  let status = 200;
  await handler({ params: { outletId: 'outlet' }, query: { startDate: '2026-08-01', endDate: '2026-08-02', ...query } }, {
    status(code) { status = code; return this; },
    json(value) { result = value; },
  });
  assert.equal(status, 200, JSON.stringify(result));
  assert.deepEqual(records, before, 'report metadata never mutates any input record');
  return { data: result.data, reads };
}

const item = (productId, name, rate, quantity, total, extra = {}) => ({
  product: { id: productId, name, category: 'c1', code: 'old-code', price: 500, discount: 99 },
  taxPercentage: rate, quantity, total, price: 999, ...extra,
});
const bill = (id, items, extra = {}) => ({
  id, dayId: '2026-08-01', inActive: false, shiftId: 'Shift-A', taxType: 'exclusive',
  finalTotal: 9999, discount: 100, serviceChargeAmount: 20, roundOff: 0.5, billSaleItems: items, ...extra,
});
const fixtures = () => [
  bill('one', [item('p1', 'Meal', 5, 2, 180), item('p2', 'Snack', 12, 1, 50), item('p1', 'Meal', 28, 100, 999, { deleted: true })]),
  bill('two', [item('p1', 'Meal', 5, 1, 100)], { dayId: '2026-08-02', shiftId: 'Shift-B', taxType: 'inclusive' }),
  bill('inactive', [item('p1', 'Meal', 18, 10, 900)], { inActive: true }),
  bill('outside', [item('p1', 'Meal', 18, 10, 900)], { dayId: '2026-08-03' }),
];

for (const kind of ['categories', 'products']) {
  test(`${kind}: historical rate metadata leaves every existing sales calculation and filter intact`, async () => {
    const { data, reads } = await reportResponse(kind, {}, fixtures());
    assert.equal(data.summary.totalAmount, 330, '180 + 50 + 100; excludes deleted and inactive/out-of-range data');
    assert.equal(data.summary.totalQuantity, 4);
    assert.equal(data.summary.totalBills, 2);
    assert.ok(reads.filter(read => read.path.endsWith('BILL_SALE_SUMMARY')).every(read => read.filters.some(([key, value]) => key === 'inActive' && value === false)));
    if (kind === 'categories') {
      assert.equal(data.categories[0].categoryNo, 13);
      assert.equal(data.categories[0].taxRate, '5%, 12%');
      assert.equal(data.categories[0].amount, 330);
      assert.equal(data.categories[0].productCount, 2);
      assert.deepEqual(data.categories[0].products.map(product => [product.name, product.quantity, product.amount, product.taxRate]), [['Meal', 3, 280, '5%'], ['Snack', 1, 50, '12%']]);
      assert.equal(data.categories[0].share, 100);
    } else {
      assert.deepEqual(data.products.map(product => [product.name, product.quantity, product.amount, product.taxRate]), [['Meal', 3, 280, '5%'], ['Snack', 1, 50, '12%']]);
      assert.equal(data.products[0].code, '0003');
      assert.equal(data.products[0].averageRate, 280 / 3);
      assert.equal(data.products[0].share, 280 / 330 * 100);
    }
    assert.equal((await reportResponse(kind, { shiftId: 'shift-a' }, fixtures())).data.summary.totalAmount, 230);
    assert.equal((await reportResponse(kind, { startDate: '2026-08-02', endDate: '2026-08-02' }, fixtures())).data.summary.totalAmount, 100);
    assert.equal((await reportResponse(kind, { search: 'Food' }, fixtures())).data.summary.totalAmount, 330);
    assert.equal((await reportResponse(kind, { search: 'not found' }, fixtures())).data.summary.totalAmount, 0);
    if (kind === 'products') assert.equal((await reportResponse(kind, { search: '0003' }, fixtures())).data.summary.totalAmount, 280);
  });

  test(`${kind}: missing, invalid, mixed and explicit no-tax historical rates have honest labels`, async () => {
    const cases = [
      { rates: [5, 5], expected: '5%' },
      { rates: [5, 12], expected: '5%, 12%' },
      { rates: [5, undefined], expected: 0 },
      { rates: [undefined], expected: 0 },
      { rates: ['5'], expected: 0 },
      { rates: [-5], expected: 0 },
      { rates: [Number.NaN], expected: 0 },
      { rates: [0], expected: '0%' },
      { rates: [5, 12, undefined], expected: '5%, 12%' },
      { rates: [5], taxType: 'NoTax', expected: '0%' },
    ];
    for (const entry of cases) {
      const bills = [bill('one', entry.rates.map(rate => item('p1', 'Meal', rate, 1, 7)), { taxType: entry.taxType ?? 'exclusive' })];
      const { data } = await reportResponse(kind, {}, bills);
      const row = data[kind][0];
      assert.equal(row.taxRate, entry.expected, JSON.stringify(entry));
      assert.equal(row.amount, 7 * entry.rates.length);
      if (kind === 'categories') assert.equal(row.products[0].taxRate, entry.expected);
    }
  });

  test(`${kind}: empty reports, signed sales and missing category numbers preserve existing behavior`, async () => {
    const empty = (await reportResponse(kind, {}, [])).data;
    assert.equal(empty.summary.totalAmount, 0);
    assert.equal(empty.summary.totalQuantity, 0);
    assert.deepEqual(empty[kind], []);
    const rows = [bill('one', [item('p1', 'Return', 5, -1, -12.3456, { product: { id: 'p1', name: 'Return', category: 'c2' } })])];
    const { data } = await reportResponse(kind, {}, rows);
    assert.equal(data.summary.totalAmount, -12.3456);
    assert.equal(data.summary.totalQuantity, -1);
    assert.equal(data[kind][0].taxRate, '5%');
    if (kind === 'categories') assert.equal(data.categories[0].categoryNo, null);
    else assert.equal(data.products[0].averageRate, 0, 'existing non-positive-quantity average rule is unchanged');
  });
}

for (const kind of ['categories', 'products']) {
  test(`${kind}: tax splits preserve Sale and match the existing GST report including inclusive, exclusive and no-tax bills`, async () => {
    const bills = fixtures();
    bills.push(bill('untaxed', [item('p1', 'Meal', 5, 1, 40)], { taxType: 'NoTax' }));
    bills.push(bill('return', [item('p1', 'Meal', 5, -1, -10)], { taxType: 'exclusive' }));
    const { data } = await reportResponse(kind, {}, bills);
    const gst = (await reportResponse('gst', {}, bills)).data;
    const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} differs from ${b}`);
    close(data.summary.totalTax, gst.summary.gst);
    assert.equal(data.summary.totalAmount, 360);
    const rows = data[kind];
    for (const row of rows) {
      close(row.taxBreakdown.reduce((sum, group) => sum + group.amount, 0), row.amount);
      close(row.taxBreakdown.reduce((sum, group) => sum + group.quantity, 0), row.quantity);
      close(row.taxBreakdown.reduce((sum, group) => sum + group.taxAmount, 0), row.taxAmount);
      const uniqueRates = row.taxBreakdown.map(group => group.rate);
      assert.equal(new Set(uniqueRates).size, uniqueRates.length);
    }
    const grouped = rows.flatMap(row => row.taxBreakdown);
    for (const rate of gst.rates) {
      const matching = grouped.filter(group => group.rate === rate.rate);
      close(matching.reduce((sum, group) => sum + group.taxAmount, 0), rate.gst);
      close(matching.reduce((sum, group) => sum + group.taxableValue, 0), rate.taxable);
    }
    const meal = kind === 'categories' ? rows[0].products.find(row => row.productId === 'p1') : rows.find(row => row.productId === 'p1');
    assert.deepEqual(meal.taxBreakdown.map(group => group.rate), [0, 5]);
    assert.equal(meal.taxBreakdown[0].amount, 40);
    assert.equal(meal.taxBreakdown[0].taxAmount, 0);
    close(meal.taxBreakdown[1].taxAmount, 9 + (100 - 100 / 1.05) - 0.5);
    if (kind === 'categories') {
      for (const group of rows[0].taxBreakdown) {
        const children = rows[0].products.flatMap(product => product.taxBreakdown).filter(child => child.rate === group.rate);
        close(children.reduce((sum, child) => sum + child.amount, 0), group.amount);
        close(children.reduce((sum, child) => sum + child.taxAmount, 0), group.taxAmount);
      }
    }
  });
}
