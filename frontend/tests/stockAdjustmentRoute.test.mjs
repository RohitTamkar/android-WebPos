import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import jwt from '../../backend/node_modules/jsonwebtoken/index.js';
import { ProductCreationError } from '../../backend/src/productCreation.js';

const source = readFileSync(new URL('../../backend/src/server.ts', import.meta.url), 'utf8');
const tree = ts.createSourceFile('server.ts', source, ts.ScriptTarget.Latest, true);
const reader = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'readAccessToken');
const route = tree.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
  && node.expression.expression.getText(tree) === 'app.post' && node.expression.arguments[0]?.text === '/api/outlets/:outletId/stock-adjustments');
assert.ok(route);
const key = 'isolated-stock-route-session-key';
function fixture(error) {
  const calls = [];
  const dependencies = { jwt, JWT_SECRET: key, ProductCreationError, assignedOutletIds: () => [],
    getFirestoreDb: () => { calls.push('database'); return {}; },
    saveStockAdjustment: async (...args) => { calls.push(args); if (error) throw error; return { documentId: 'stock-request', alreadySaved: false }; } };
  const js = ts.transpileModule(`${reader.getText(tree)}\nconst handler = ${route.expression.arguments[1].getText(tree)};`,
    { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.None } }).outputText;
  const handler = new Function(...Object.keys(dependencies), `${js}; return handler;`)(...Object.values(dependencies));
  return { calls, async request(token = jwt.sign({ profileDocId: 'signed' }, key)) {
    const body = { requestId: 'stable-request', direction: 'in', items: [], profileDocId: 'forged' };
    const req = { header: name => name === 'authorization' && token ? `Bearer ${token}` : undefined, params: { outletId: 'outlet' }, body };
    const res = { statusCode: 200, headers: {}, setHeader(name, value) { this.headers[name] = value; },
      status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } };
    await handler(req, res); return res;
  } };
}

test('invalid and expired sessions cannot initialize the stock service or act as a signed user', async () => {
  for (const token of ['', 'forged', jwt.sign({ profileDocId: 'signed' }, key, { expiresIn: -1 }), jwt.sign({ sub: 'transfer-user' }, key)]) {
    const f = fixture(); assert.equal((await f.request(token)).statusCode, 401); assert.deepEqual(f.calls, []);
  }
});
test('stock confirmation uses signed identity and returns the service receipt without caching', async () => {
  const f = fixture(); const response = await f.request();
  assert.equal(response.statusCode, 200); assert.equal(response.headers['Cache-Control'], 'no-store');
  assert.equal(response.body.data.documentId, 'stock-request');
  assert.equal(f.calls[1][1], 'outlet'); assert.equal(f.calls[1][2], 'signed');
});
test('uncertain database failures return 503 to retain the retry request; known validation failures preserve their status', async () => {
  for (const error of [new Error('PRIVATE DATABASE ERROR'), new ProductCreationError(409, 'Stock changed'), new ProductCreationError(403, 'Outlet denied')]) {
    const f = fixture(error); const response = await f.request();
    assert.equal(response.statusCode, error instanceof ProductCreationError ? error.status : 503);
    assert.equal(response.body.success, false); assert.ok(!response.body.message.includes('PRIVATE'));
  }
});
