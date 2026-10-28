import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
// Execute the real route without starting Express, Firebase or any service.
const source = readFileSync(new URL('../../backend/src/server.ts', import.meta.url), 'utf8');
const tree = ts.createSourceFile('server.ts', source, ts.ScriptTarget.Latest, true);
const route = tree.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
  && node.expression.expression.getText(tree) === 'app.get' && node.expression.arguments[0]?.text === '/api/outlets/:outletId/categories');
const code = ts.transpileModule(`return ${route.expression.arguments[1].getText(tree)}`, { compilerOptions: { target: ts.ScriptTarget.ES2023 } }).outputText;
function fixture(omit = false, authorized = true) {
  const queries = [];
  const collection = kind => ({ get: async () => {
    queries.push(kind); if (kind === 'PRODUCT') throw new Error('Never download entire product documents to count categories');
    return { docs: [{ id: 'cat', data: () => ({ name: 'Food', categoryNo: 1 }), createTime: undefined }] };
  }, select: field => { assert.equal(kind, 'PRODUCT'); assert.equal(field, 'category'); return { get: async () => { queries.push('PRODUCT.category'); return { docs: [{ data: () => ({ category: 'cat' }) }] }; } }; } });
  const db = { collection: name => ({ doc: () => name === 'USER_PROFILE' ? { get: async () => ({ exists: true, data: () => ({ active: true, outlets: authorized ? ['outlet'] : [] }) }) }
    : { collection } }) };
  const handler = new Function('getFirestoreDb', 'readAccessToken', 'assignedOutletIds', 'stringValue', code)(() => db, () => ({ profileDocId: 'user' }), profile => profile.outlets, value => typeof value === 'string' ? value : '');
  let status = 200, body;
  const res = { status: value => { status = value; return res; }, json: value => { body = value; } };
  return { queries, request: async () => { await handler({ params: { outletId: 'outlet' }, header: name => name === 'x-category-counts' && omit ? 'omit' : undefined }, res); return { status, body }; } };
}
test('metadata requests read categories without scanning products', async () => {
  const f = fixture(true), result = await f.request(); assert.equal(result.status, 200); assert.deepEqual(f.queries, ['CATEGORY']);
  assert.equal(result.body.data[0].name, 'Food'); assert.ok(!('productCount' in result.body.data[0]));
});
test('default category list preserves counts and reads only the category product field', async () => {
  const f = fixture(), result = await f.request(); assert.equal(result.body.data[0].productCount, 1); assert.deepEqual(f.queries.sort(), ['CATEGORY', 'PRODUCT.category']);
});
test('metadata optimization never bypasses outlet authorization', async () => {
  const f = fixture(true, false), result = await f.request(); assert.equal(result.status, 403); assert.deepEqual(f.queries, []);
});
