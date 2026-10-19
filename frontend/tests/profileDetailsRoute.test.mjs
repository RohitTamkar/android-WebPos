import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { ProductCreationError, requireProductOutlet } from '../../backend/src/productCreation.js';
const source = readFileSync(new URL('../../backend/src/server.ts', import.meta.url), 'utf8');
const tree = ts.createSourceFile('server.ts', source, ts.ScriptTarget.Latest, true);
const route = tree.statements.find(n => ts.isExpressionStatement(n) && ts.isCallExpression(n.expression)
  && n.expression.expression.getText(tree) === 'app.get' && n.expression.arguments[0]?.text === '/api/outlets/:outletId/profile');
assert.ok(route);
const role = tree.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'profileRole');
const js = ts.transpileModule(`${role.getText(tree)}\nconst handler = ${route.expression.arguments[1].getText(tree)};`,
  { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.None } }).outputText;
function fixture({ profile = { active: true, name: 'Database User', mobile: '+919876543210', roll: 'admin', quickPin: 'SECRET', outletId: 'outlet' }, exists = true, failure = false } = {}) {
  const reads = [];
  const deps = {
    ProductCreationError, requireProductOutlet,
    readAccessToken: req => req.user ? { profileDocId: req.user } : null,
    assignedOutletIds: data => [data.outletId], stringValue: v => typeof v === 'string' ? v : '',
    getFirestoreDb: () => ({ collection: name => ({ doc: id => ({ get: async () => {
      reads.push([name, id]);
      if (failure) throw new Error('SENSITIVE INTERNAL DETAIL');
      return { exists, data: () => name === 'USER_PROFILE' ? profile : { name: 'Database Outlet', privateField: 'SECRET' } };
    } }) }) }),
  };
  const handler = new Function(...Object.keys(deps), `${js}; return handler;`)(...Object.values(deps));
  return { reads, async request(user = 'profile-id', outletId = 'outlet') {
    const res = { statusCode: 200, body: null, headers: {}, setHeader(k,v) { this.headers[k]=v; }, status(code) { this.statusCode=code;return this; }, json(body) {this.body=body;} };
    await handler({ user, params: { outletId } }, res); return res;
  } };
}
test('reads the signed-in profile and authorized outlet and exposes only display fields', async () => {
  const f=fixture(); const res=await f.request();
  assert.equal(res.statusCode,200);
  assert.deepEqual(res.body,{success:true,data:{name:'Database User',mobile:'+919876543210',role:'Admin',outletName:'Database Outlet'}});
  assert.deepEqual(f.reads,[['USER_PROFILE','profile-id'],['OUTLET','outlet']]);
  assert.equal(res.headers['Cache-Control'],'no-store');
  assert.ok(!JSON.stringify(res.body).includes('SECRET'));
});
test('unauthenticated requests perform no database reads',async()=>{
  const f=fixture(); assert.equal((await f.request(null)).statusCode,401); assert.deepEqual(f.reads,[]);
});
test('inactive profiles and unassigned outlets cannot read outlet details',async()=>{
  const inactive=fixture({profile:{active:false,outletId:'outlet'}});
  assert.equal((await inactive.request()).statusCode,403);assert.equal(inactive.reads.length,1);
  const f=fixture();assert.equal((await f.request('profile-id','another-outlet')).statusCode,403);assert.equal(f.reads.length,1);
});
test('missing fields stay empty and roles use the existing login formatter',async()=>{
  const f=fixture({profile:{active:true,outletId:'outlet',roll:'user'}});
  assert.deepEqual((await f.request()).body.data,{name:'',mobile:'',role:'User',outletName:'Database Outlet'});
});
test('missing outlets and database failures return compatible errors without leaking data',async()=>{
  assert.equal((await fixture({exists:false}).request()).statusCode,404);
  const res=await fixture({failure:true}).request();assert.equal(res.statusCode,503);
  assert.ok(!JSON.stringify(res.body).includes('SENSITIVE'));
});
