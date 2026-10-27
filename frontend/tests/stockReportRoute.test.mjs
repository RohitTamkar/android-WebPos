import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import jwt from '../../backend/node_modules/jsonwebtoken/index.js';
import { saveStockAdjustment } from '../../backend/src/stockAdjustment.js';

const source = readFileSync(new URL('../../backend/src/server.ts', import.meta.url), 'utf8');
const tree = ts.createSourceFile('server.ts', source, ts.ScriptTarget.Latest, true);
const route = tree.statements.find(n => ts.isExpressionStatement(n) && ts.isCallExpression(n.expression)
  && n.expression.expression.getText(tree) === 'app.get' && n.expression.arguments[0]?.text === '/api/outlets/:outletId/reports/stock');
assert.ok(route);
const functions = ['readAccessToken', 'stringValue', 'numberValue'].map(name => tree.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name).getText(tree));
const js = ts.transpileModule(`${functions.join('\n')}\nconst handler = ${route.expression.arguments[1].getText(tree)};`,
  { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.None } }).outputText;
const key = 'isolated-stock-report-key';
const token = jwt.sign({ profileDocId: 'user' }, key);
const productPath = 'OUTLET/outlet/PRODUCT/tea';
function fixture(stockable = false) {
  const records = new Map([
    ['USER_PROFILE/user', { active: true, outlets: ['outlet'] }],
    [productPath, { name: 'Tea', code: 1, currentStock: 0, stockable, category: 'drinks', price: 2, reorderLevel: 5 }],
    ['OUTLET/outlet/PRODUCT/service', { name: 'Service', currentStock: 0, stockable: false }],
    ['OUTLET/outlet/PRODUCT/tracked', { name: 'Tracked zero', currentStock: 0, stockable: true }],
    ['OUTLET/outlet/CATEGORY/drinks', { name: 'Drinks' }],
    ['OUTLET/other/PRODUCT/tea', { name: 'Other outlet', currentStock: 999, stockable: true }],
  ]);
  const reads = [];
  function ref(path, filters = []) {
    return { path, id: path.split('/').at(-1), collection: name => ref(`${path}/${name}`), doc: id => ref(`${path}/${id}`),
      where: (field, _operator, value) => ref(path, [...filters, [field, value]]),
      get: async () => {
        reads.push(path);
        if (path.split('/').length % 2 === 0) return { exists: records.has(path), data: () => structuredClone(records.get(path)) };
        return { docs: [...records].filter(([p, data]) => p.startsWith(`${path}/`) && p.split('/').length === path.split('/').length + 1
          && filters.every(([field, value]) => data[field] === value)).map(([p, data]) => ({ id: p.split('/').at(-1), data: () => structuredClone(data) })) };
      } };
  }
  const db = { collection: name => ref(name), runTransaction: async work => {
    const pending = [];
    const result = await work({ get: r => r.get(), create: (r, data) => pending.push([r.path, data]),
      update: (r, patch) => pending.push([r.path, { ...records.get(r.path), ...patch }]) });
    for (const [path, data] of pending) records.set(path, data);
    return result;
  } };
  const assignedOutletIds = p => p.outlets;
  const deps = { jwt, JWT_SECRET: key, getFirestoreDb: () => db, assignedOutletIds };
  const handler = new Function(...Object.keys(deps), `${js};return handler;`)(...Object.values(deps));
  let sequence = 0;
  return { records, reads,
    adjust: async (direction, quantity, requestId = `71000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`) => saveStockAdjustment(db, 'outlet', 'user', assignedOutletIds,
      { requestId, direction, items: [{ productId: 'tea', quantity, expectedStock: records.get(productPath).currentStock, remark: direction === 'out' ? 'Issued' : '' }] }),
    report: async (auth = token, outletId = 'outlet') => {
      const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } };
      await handler({ header: () => auth ? `Bearer ${auth}` : undefined, params: { outletId } }, res);
      return res;
    },
  };
}

test('50 stock in minus 5 stock out appears as 45 for a stockable product', async () => {
  {
    const stockable = true;
    const f = fixture(stockable);
    await f.adjust('in', 50);
    let response = await f.report();
    assert.equal(response.body.data.products.find(p => p.productId === 'tea').currentStock, 50);
    await f.adjust('out', 5);
    response = await f.report();
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['Cache-Control'], 'no-store');
    const tea = response.body.data.products.find(p => p.productId === 'tea');
    assert.equal(tea.currentStock, 45); assert.equal(tea.stockValue, 90); assert.equal(tea.status, 'In stock');
    assert.equal(tea.tracked, true); assert.equal(tea.category, 'Drinks');
    assert.equal(response.body.data.products.reduce((sum, p) => sum + p.currentStock, 0), 45);
    assert.equal(response.body.data.products.some(p => p.productId === 'service'), false, 'Empty untracked services remain excluded');
    assert.equal(f.records.get(productPath).stockable, stockable, 'Reporting does not change product flags');
    assert.ok(!f.reads.includes('OUTLET/outlet/GOODS_RECEIVED'), 'Report reads the saved balance instead of reapplying movements');
  }
});

test('fractional stock and zero balances stay accurate and unchanged retries cannot double count', async () => {
  const f = fixture(true);
  const id = '71000000-0000-4000-8000-000000000099';
  await f.adjust('in', 50.125, id); await f.adjust('in', 50.125, id);
  await f.adjust('out', 5.025);
  assert.equal((await f.report()).body.data.products.find(p => p.productId === 'tea').currentStock, 45.1);
  await f.adjust('out', 45.1);
  const row = (await f.report()).body.data.products.find(p => p.productId === 'tea');
  assert.equal(row.currentStock, 0); assert.equal(row.stockValue, 0); assert.equal(row.status, 'Out of stock');
});

test('report rejects missing sessions and other outlets before inventory reads', async () => {
  const f = fixture();
  assert.equal((await f.report(null)).statusCode, 401); assert.deepEqual(f.reads, []);
  assert.equal((await f.report(token, 'other')).statusCode, 403);
  assert.deepEqual(f.reads, ['USER_PROFILE/user']);
});


test('non-stockable products are absent from the report even when they have existing stock', async () => {
  for (const stockable of [false, undefined, 'true', 1, null]) {
    const f = fixture();
    Object.assign(f.records.get(productPath), { currentStock: 45, stockable });
    const response = await f.report();
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body.data.products.map(p => p.productId), ['tracked']);
    assert.equal(response.body.data.products[0].currentStock, 0, 'Stockable zero balances remain visible');
    await assert.rejects(f.adjust('in', 1), /Only products marked Stockable/);
    await assert.rejects(f.adjust('out', 1), /Only products marked Stockable/);
    assert.equal(f.records.get(productPath).currentStock, 45, 'Existing stock is preserved');
  }
});
