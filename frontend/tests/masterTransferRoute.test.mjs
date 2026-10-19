import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import jwt from '../../backend/node_modules/jsonwebtoken/index.js';
import { ProductCreationError } from '../../backend/src/productCreation.js';
const text = readFileSync(new URL('../../backend/src/server.ts', import.meta.url), 'utf8');
const tree = ts.createSourceFile('server.ts', text, ts.ScriptTarget.Latest, true);
const reader = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'readAccessToken');
const route = tree.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
  && node.expression.expression.getText(tree) === 'app.post' && node.expression.arguments[0]?.text === '/api/outlets/:outletId/master-transfer');
assert.ok(route);
const sessionKey = 'isolated-session-key';
function fixture(error) {
  const calls = [];
  const dependencies = { jwt, JWT_SECRET: sessionKey, TRANSFER_JWT_SECRET: 'isolated-master-transfer-signing-key', ProductCreationError,
    getFirestoreDb: () => { calls.push('db'); return {}; }, assignedOutletIds: () => [],
    transferOutletMasters: async (...args) => { calls.push(args); if (error) throw error; return { items: [], created: 0, skipped: 0, unchanged: 0 }; } };
  const js = ts.transpileModule(`${reader.getText(tree)}\nconst handler = ${route.expression.arguments[1].getText(tree)};`,
    { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.None } }).outputText;
  const handler = new Function(...Object.keys(dependencies), `${js};return handler;`)(...Object.values(dependencies));
  return { calls, async request(token) {
    const req = { header: name => name === 'authorization' ? token ? `Bearer ${token}` : undefined : 'destination-scoped-grant',
      params: { outletId: 'source' }, body: { destinationOutletId: 'destination', profileDocId: 'forged' } };
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } };
    await handler(req, res); return res;
  } };
}
test('missing, invalid, expired and transfer-only tokens cannot act as login sessions', async () => {
  for (const token of [undefined, 'forged', jwt.sign({ profileDocId: 'signed' }, sessionKey, { expiresIn: -1 }),
    jwt.sign({ sub: 'signed', purpose: 'master-transfer' }, sessionKey)]) {
    const f = fixture(); assert.equal((await f.request(token)).statusCode, 401); assert.deepEqual(f.calls, []);
  }
});
test('authenticated transfer passes signed identity and scoped grant to the service', async () => {
  const f = fixture(); const response = await f.request(jwt.sign({ profileDocId: 'signed' }, sessionKey));
  assert.equal(response.statusCode, 200); assert.equal(response.body.success, true);
  assert.equal(response.headers['Cache-Control'], 'no-store');
  assert.equal(f.calls[1][1], 'source'); assert.equal(f.calls[1][2], 'signed');
  assert.equal(f.calls[1][5], 'destination-scoped-grant');
});
test('authorization and commit failures never return success or expose internal errors', async () => {
  for (const error of [new ProductCreationError(403, 'Verify QuickPin again'), new Error('PRIVATE DATABASE ERROR')]) {
    const f = fixture(error); const response = await f.request(jwt.sign({ profileDocId: 'signed' }, sessionKey));
    assert.equal(response.statusCode, error instanceof ProductCreationError ? 403 : 503);
    assert.equal(response.body.success, false); assert.ok(!response.body.message.includes('PRIVATE'));
  }
});
