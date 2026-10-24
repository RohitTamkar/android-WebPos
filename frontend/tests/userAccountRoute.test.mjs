import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import jwt from '../../backend/node_modules/jsonwebtoken/index.js';
import { z } from '../../backend/node_modules/zod/index.js';
const source = readFileSync(new URL('../../backend/src/server.ts', import.meta.url), 'utf8');
const tree = ts.createSourceFile('server.ts', source, ts.ScriptTarget.Latest, true);
const reader = tree.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'readAccessToken');
class UserAccountError extends Error { constructor(status, message) { super(message); this.status = status; } }
function fixture(method, failure) {
  const calls = [];
  const route = tree.statements.find(n => ts.isExpressionStatement(n) && ts.isCallExpression(n.expression)
    && n.expression.expression.getText(tree) === `app.${method}` && n.expression.arguments[0]?.text === '/api/auth/account');
  assert.ok(route);
  const js = ts.transpileModule(`${reader.getText(tree)}\nconst handler = ${route.expression.arguments[1].getText(tree)};`,
    { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.None } }).outputText;
  const deps = { jwt, JWT_SECRET: 'isolated-test-key', UserAccountError,
    getFirestoreDb: () => { calls.push('db'); return {}; },
    readUserAccount: async (_db, id) => { calls.push(['read', id]); if (failure) throw failure; return { name: 'Database User' }; },
    updateUserAccount: async (_db, id, patch) => { calls.push(['update', id, patch]); if (failure) throw failure; return { name: patch.name }; },
  };
  const handler = new Function(...Object.keys(deps), `${js};return handler;`)(...Object.values(deps));
  return { calls, async request(token, extras = {}) {
    const req = { header: () => token ? `Bearer ${token}` : undefined, body: { name: 'Edited' }, params: { userId: 'other' }, query: { profileDocId: 'other', userId: 'other' }, ...extras };
    const res = { statusCode: 200, headers: {}, setHeader(k,v) { this.headers[k]=v; }, status(code) { this.statusCode=code;return this; }, json(body) {this.body=body;} };
    await handler(req,res); return res;
  } };
}
const token = jwt.sign({ profileDocId: 'signed-profile', userId: 'signed-user' }, 'isolated-test-key', { expiresIn: '1h' });
for (const method of ['get', 'patch']) {
  test(`${method} derives the profile from a verified JWT despite forged URL/query identity`, async () => {
    const f=fixture(method); const response=await f.request(token);
    assert.equal(response.statusCode,200);assert.equal(response.headers['Cache-Control'],'no-store');
    assert.equal(f.calls[1][1],'signed-profile');
  });
  test(`${method} rejects missing, forged, expired and incomplete JWTs before accessing the database`,async()=>{
    for (const bad of [undefined, 'forged', jwt.sign({profileDocId:'other'},'wrong-key'),
      jwt.sign({profileDocId:'other'},'isolated-test-key',{expiresIn:-1}), jwt.sign({userId:'other'},'isolated-test-key')]) {
      const f=fixture(method);assert.equal((await f.request(bad)).statusCode,401);assert.deepEqual(f.calls,[]);
    }
  });
  test(`${method} handles authorization and database errors without exposing internal data`,async()=>{
    assert.equal((await fixture(method,new UserAccountError(403,'Inactive account')).request(token)).statusCode,403);
    const res=await fixture(method,new Error('PRIVATE INTERNAL ERROR')).request(token);
    assert.equal(res.statusCode,503);assert.ok(!JSON.stringify(res.body).includes('PRIVATE'));
  });
}

function loginFixture(profile = { active: true, id: 'public-user', name: 'Current Name', email: 'current@example.com', quickPin: '1234', roll: 'admin' }) {
  const route = tree.statements.find(n => ts.isExpressionStatement(n) && ts.isCallExpression(n.expression)
    && n.expression.expression.getText(tree) === 'app.post' && n.expression.arguments[0]?.text === '/api/auth/login');
  const schema = tree.statements.find(n => ts.isVariableStatement(n) && n.declarationList.declarations.some(d => d.name.getText(tree) === 'loginSchema'));
  const role = tree.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'profileRole');
  const js = ts.transpileModule(`${schema.getText(tree)}\n${role.getText(tree)}\nconst handler = ${route.expression.arguments[1].getText(tree)};`,
    { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.None } }).outputText;
  const deps = { z, jwt, JWT_SECRET: 'isolated-test-key', getFirebaseApp: () => ({}), getFirestoreDb: () => ({
    collection: name => { assert.equal(name,'USER_PROFILE');return { where: (field, op, email) => {
      assert.equal(field,'email');assert.equal(op,'==');
      return { get: async () => ({ docs: profile.email === email ? [{ id: 'signed-profile', data: () => profile }] : [] }) };
    } }; },
  }) };
  const handler = new Function(...Object.keys(deps), `${js};return handler;`)(...Object.values(deps));
  return async body => {
    const res = { statusCode:200, status(code){this.statusCode=code;return this;}, json(data){this.body=data;} };
    await handler({body},res);return res;
  };
}
test('existing login still queries the current email and verifies the existing PIN with the same session identity',async()=>{
  const login=loginFixture();
  const res=await login({email:'current@example.com',quickPin:'1234'});
  assert.equal(res.statusCode,200);assert.equal(res.body.data.user.id,'public-user');
  assert.equal(res.body.data.user.name,'Current Name');
  assert.equal(jwt.verify(res.body.data.token,'isolated-test-key').profileDocId,'signed-profile');
  assert.ok(!JSON.stringify(res.body).includes('1234'));
  assert.equal((await login({email:'current@example.com',quickPin:'9999'})).statusCode,401);
  assert.equal((await login({email:'old@example.com',quickPin:'1234'})).statusCode,401);
  assert.equal((await login({email:'bad-email',quickPin:'1234'})).statusCode,400);
  assert.equal((await loginFixture({active:false,email:'current@example.com',quickPin:'1234'})({email:'current@example.com',quickPin:'1234'})).statusCode,403);
});
