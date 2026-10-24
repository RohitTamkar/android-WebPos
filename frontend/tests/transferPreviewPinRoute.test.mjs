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
  && node.expression.expression.getText(tree) === 'app.post' && node.expression.arguments[0]?.text === '/api/outlets/:outletId/transfer-preview/verify-quick-pin');
assert.ok(route);
function fixture(failure) {
  const calls = [];
  const dependencies = { jwt, JWT_SECRET: 'isolated-preview-pin-tests', TRANSFER_JWT_SECRET: 'isolated-master-transfer-signing-key', ProductCreationError, assignedOutletIds: () => [],
    issueTransferAuthorization: (...args) => { calls.push(['grant', ...args]); return 'scoped-transfer-grant'; },
    getFirestoreDb: () => ({}), verifyTransferPreviewPin: async (...args) => { calls.push(args); if (failure) throw failure; return { verified: true, destinationOutletId: 'destination' }; } };
  const js = ts.transpileModule(`${reader.getText(tree)}\nconst handler = ${route.expression.arguments[1].getText(tree)};`,
    { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.None } }).outputText;
  const handler = new Function(...Object.keys(dependencies), `${js};return handler;`)(...Object.values(dependencies));
  return { calls, async request(token) {
    const req = { header: () => token ? `Bearer ${token}` : undefined, params: { outletId: 'source' }, body: { destinationOutletId: 'destination', quickPin: '1234', profileId: 'forged' } };
    const res = { statusCode: 200, headers: {}, setHeader(key, value) { this.headers[key] = value; }, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; } };
    await handler(req, res); return res;
  } };
}
test('rejects missing, forged and expired sessions before service access', async () => {
  for (const token of [undefined, 'invalid', jwt.sign({ profileDocId: 'forged' }, 'wrong-key'), jwt.sign({ profileDocId: 'signed' }, 'isolated-preview-pin-tests', { expiresIn: -1 })]) {
    const f = fixture(); assert.equal((await f.request(token)).statusCode, 401); assert.deepEqual(f.calls, []);
  }
});
test('uses signed identity, selected source and no-store response', async () => {
  const f = fixture(); const response = await f.request(jwt.sign({ profileDocId: 'signed' }, 'isolated-preview-pin-tests'));
  assert.equal(response.headers['Cache-Control'], 'no-store'); assert.deepEqual(f.calls[0].slice(1, 3), ['source', 'signed']);
  assert.deepEqual(response.body, { success: true, data: { verified: true, destinationOutletId: 'destination', transferToken: 'scoped-transfer-grant' } });
  assert.deepEqual(f.calls[1].slice(2), ['signed', 'source', 'destination']);
});
test('returns PIN errors without logging or exposing database failures', async () => {
  const token = jwt.sign({ profileDocId: 'signed' }, 'isolated-preview-pin-tests');
  for (const status of [403, 422, 429]) assert.equal((await fixture(new ProductCreationError(status, 'Verification unavailable')).request(token)).statusCode, status);
  const failed = await fixture(new Error('PRIVATE DATABASE DETAIL')).request(token);
  assert.equal(failed.statusCode, 503); assert.ok(!JSON.stringify(failed.body).includes('PRIVATE'));
});
