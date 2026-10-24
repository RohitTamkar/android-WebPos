import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import jwt from '../../backend/node_modules/jsonwebtoken/index.js';
import { ProductCreationError } from '../../backend/src/productCreation.js';
const source = readFileSync(new URL('../../backend/src/server.ts', import.meta.url), 'utf8');
const tree = ts.createSourceFile('server.ts', source, ts.ScriptTarget.Latest, true);
const reader = tree.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'readAccessToken');
function fixture(method, failure) {
  const calls = [];
  const route = tree.statements.find(n => ts.isExpressionStatement(n) && ts.isCallExpression(n.expression)
    && n.expression.expression.getText(tree) === `app.${method}` && n.expression.arguments[0]?.text === '/api/outlets/:outletId/devices');
  assert.ok(route);
  const js = ts.transpileModule(`${reader.getText(tree)}\nconst handler = ${route.expression.arguments[1].getText(tree)};`,
    { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.None } }).outputText;
  const deps = { jwt, JWT_SECRET: 'isolated-devices-test-key', ProductCreationError, assignedOutletIds: () => [],
    getFirestoreDb: () => { calls.push('db'); return {}; },
    listOutletDevices: async (_db, outlet, profile) => { calls.push(['list', outlet, profile]); if (failure) throw failure; return { devices: [] }; },
    createOutletDevice: async (_db, outlet, profile, _assigned, body) => { calls.push(['create', outlet, profile, body]); if (failure) throw failure; return { documentId: 'saved' }; },
  };
  const handler = new Function(...Object.keys(deps), `${js};return handler;`)(...Object.values(deps));
  return { calls, async request(token) {
    const req = { header: () => token ? `Bearer ${token}` : undefined, params: { outletId: 'selected-outlet' },
      body: { name: 'Draft', profileId: 'forged-profile' }, query: { profileId: 'forged-profile' } };
    const res = { statusCode: 200, headers: {}, setHeader(k,v) { this.headers[k]=v; }, status(code) { this.statusCode=code;return this; }, json(body) {this.body=body;} };
    await handler(req,res); return res;
  } };
}
const token = jwt.sign({ profileDocId: 'signed-profile' }, 'isolated-devices-test-key', { expiresIn: '1h' });
for (const method of ['get']) {
  test(`${method} passes the signed identity and selected outlet to the authorized device service`, async () => {
    const f = fixture(method); const res = await f.request(token);
    assert.equal(res.statusCode,200);assert.deepEqual(f.calls[1].slice(1,3),['selected-outlet','signed-profile']);
    if(method==='get')assert.equal(res.headers['Cache-Control'],'no-store');
  });
  test(`${method} rejects missing, invalid and expired tokens before database access`, async () => {
    for (const bad of [undefined,'forged',jwt.sign({profileDocId:'other'},'wrong-key'), jwt.sign({profileDocId:'other'},'isolated-devices-test-key',{expiresIn:-1})]) {
      const f=fixture(method);assert.equal((await f.request(bad)).statusCode,401);assert.deepEqual(f.calls,[]);
    }
  });
  test(`${method} handles access errors and database failures without false success or internal details`, async () => {
    assert.equal((await fixture(method,new ProductCreationError(403,'Outlet access denied')).request(token)).statusCode,403);
    const response=await fixture(method,new Error('SECRET INTERNAL DATABASE DETAIL')).request(token);
    assert.equal(response.statusCode,503);assert.equal(response.body.success,false);assert.ok(!JSON.stringify(response.body).includes('SECRET'));
  });
}

test('device status and registration mutations are not introduced', () => {
  const mutations = tree.statements.filter(n => ts.isExpressionStatement(n) && ts.isCallExpression(n.expression)
    && ['app.post','app.patch','app.put','app.delete'].includes(n.expression.expression.getText(tree))
    && String(n.expression.arguments[0]?.text).includes('/devices'));
  assert.equal(mutations.length,0);
});
