// Execute only the extracted handler with mocked dependencies, never the live server.
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
  && node.expression.expression.getText(tree) === 'app.post'
  && node.expression.arguments[0]?.text === '/api/outlets/:outletId/usage/initialize');
assert.ok(route);
const secret = 'isolated-usage-route-test-key';
class DailyUsageError extends ProductCreationError { constructor(status, code, message) { super(status, message); this.code = code; } }
function fixture(failure, lifecycle = false) {
  const calls = [];
  const dependencies = { jwt, JWT_SECRET: secret, ProductCreationError, DailyUsageError, assignedOutletIds: () => [],
    getFirestoreDb: () => { calls.push('db'); return {}; },
    initializeOutletDailyUsage: async (...args) => {
      calls.push(args); if (failure) throw failure;
      return { outletId: args[1], initialized: true, reset: false, date: '2026-10-19', timeZone: 'Asia/Kolkata', usedSeconds: 0, limitSeconds: 1800 };
    } };
  dependencies.operateOutletDailyUsage = dependencies.initializeOutletDailyUsage;
  const chosenRoute = lifecycle ? tree.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
    && node.expression.expression.getText(tree) === 'app.post' && node.expression.arguments[0]?.text === '/api/outlets/:outletId/usage/:action') : route;
  const js = ts.transpileModule(`${reader.getText(tree)}\nconst handler = ${chosenRoute.expression.arguments[1].getText(tree)};`,
    { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.None } }).outputText;
  const handler = new Function(...Object.keys(dependencies), `${js};return handler;`)(...Object.values(dependencies));
  return { calls, async request(token, body = {}, action = 'start') {
    const req = { header: () => token ? `Bearer ${token}` : undefined, params: { outletId: 'actual-document', action }, body };
    const res = { statusCode: 200, headers: {}, setHeader(key, value) { this.headers[key] = value; },
      status(code) { this.statusCode = code; return this; }, json(data) { this.body = data; } };
    await handler(req, res); return res;
  } };
}
const token = jwt.sign({ profileDocId: 'signed-user' }, secret);
test('uses the JWT identity and document ID, with no-store and no raw outlet/session response', async () => {
  const f = fixture(); const res = await f.request(token);
  assert.equal(res.statusCode, 200); assert.equal(res.body.success, true);
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.equal(f.calls[1][1], 'actual-document'); assert.equal(f.calls[1][2], 'signed-user');
  assert.deepEqual(f.calls[1][4], {}); assert.ok(!('sessions' in res.body.data));
});
test('invalid, expired, unsigned and transfer-only credentials fail before database initialization', async () => {
  for (const bad of [undefined, 'forged', jwt.sign({ profileDocId: 'user' }, 'wrong-key'),
    jwt.sign({ profileDocId: 'user' }, secret, { expiresIn: -1 }), jwt.sign({ sub: 'user', purpose: 'master-transfer' }, secret)]) {
    const f = fixture(); assert.equal((await f.request(bad)).statusCode, 401); assert.deepEqual(f.calls, []);
  }
});
test('service validation and authorization failures propagate; database errors reveal no internals or false success', async () => {
  for (const error of [new ProductCreationError(422, 'Timezone missing'), new ProductCreationError(403, 'Access denied'),
    new ProductCreationError(409, 'Existing period requires review'), new Error('PRIVATE DATABASE DETAIL')]) {
    const f = fixture(error); const res = await f.request(token);
    assert.equal(res.statusCode, error instanceof ProductCreationError ? error.status : 503);
    assert.equal(res.body.success, false); assert.ok(!JSON.stringify(res.body).includes('PRIVATE'));
  }
});
test('initialization is explicit and is not invoked by login or existing application routes', () => {
  const calls = [...source.matchAll(/await initializeOutletDailyUsage\(/g)];
  assert.equal(calls.length, 1);
  assert.ok(route.getText(tree).includes('await initializeOutletDailyUsage('));
});

test('lifecycle actions use signed identity, keep counters server-controlled, and preserve structured errors', async () => {
  const f = fixture(undefined, true); const response = await f.request(token, { requestId: 'random-request' });
  assert.equal(response.statusCode, 200); assert.equal(f.calls[1][2], 'signed-user');
  assert.deepEqual(f.calls[1][4], { action: 'start', requestId: 'random-request' });
  assert.equal((await fixture(undefined, true).request(undefined)).statusCode, 401);
  const forged = fixture(undefined, true); assert.equal((await forged.request(token, { action: 'status' })).statusCode, 422); assert.deepEqual(forged.calls, []);
  assert.equal((await fixture(undefined, true).request(token, {}, 'unknown')).statusCode, 404);
  const exhausted = await fixture(new DailyUsageError(403, 'USAGE_LIMIT_REACHED', 'Exhausted'), true).request(token);
  assert.equal(exhausted.statusCode, 403); assert.equal(exhausted.body.code, 'USAGE_LIMIT_REACHED');
});
test('the usage guard is registered before outlet routes and cannot be bypassed by missing headers', () => {
  const guardIndex = source.indexOf("app.use('/api/outlets/:outletId', createWebUsageGuard(");
  assert.ok(guardIndex >= 0 && guardIndex < source.indexOf('app.get("/api/outlets/:outletId/dashboard"'));
});
