import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import jwt from '../../backend/node_modules/jsonwebtoken/index.js';
import { verifyProductImagePin, requireProductImageAuthorization } from '../../backend/src/productImageAuthorization.ts';
import { ProductCreationError, requireProductOutlet } from '../../backend/src/productCreation.ts';
import { ImageStorageError } from '../../backend/src/imageStorage.ts';
import { FirebaseConfigurationError } from '../../backend/src/firebase.ts';

const source = readFileSync(new URL('../../backend/src/server.ts', import.meta.url), 'utf8');
const tree = ts.createSourceFile('server.ts', source, ts.ScriptTarget.Latest, true);
const functionText = name => tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(tree);
const verification = tree.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
  && node.expression.arguments[0]?.text === '/api/outlets/:outletId/product-images/verify-quick-pin');
const removal = tree.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
  && node.expression.arguments[0]?.text === '/api/outlets/:outletId/product-image-removals/:documentId');
const key = 'product-image-route-test-signing-key-12345';
let sequence = 0;
function fixture() {
  const id = `image-route-${++sequence}`;
  const token = jwt.sign({ profileDocId: id }, key);
  const profile = { active: true, quickPin: '1234', outlets: ['outlet'] };
  const writes = [];
  const ref = path => ({ collection: value => ref(`${path}/${value}`), doc: value => ref(`${path}/${value}`),
    get: async () => ({ exists: true, data: () => path === `USER_PROFILE/${id}` ? profile : { image: 'old.png' } }) });
  const dependencies = { jwt, JWT_SECRET: key, IMAGE_JWT_SECRET: key, ProductCreationError, requireProductOutlet,
    ImageStorageError, FirebaseConfigurationError, verifyProductImagePin, requireProductImageAuthorization,
    getFirestoreDb: () => ({ collection: name => ref(name) }),
    removeMasterImage: async (...args) => { writes.push(args); return { removed: true }; } };
  const js = ts.transpileModule([...['readAccessToken', 'assignedOutletIds', 'authorizeImageTarget', 'imageApiError'].map(functionText),
    `const verify=${verification.expression.arguments[1].getText(tree)}; const remove=${removal.expression.arguments[1].getText(tree)};`].join('\n'),
  { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.None } }).outputText;
  const handlers = new Function(...Object.keys(dependencies), `${js}; return {verify, remove};`)(...Object.values(dependencies));
  return { token, profile, writes, async request(which, { body, grant, session = token } = {}) {
    const req = { params: { outletId: 'outlet', documentId: 'product' }, body,
      header: name => name === 'authorization' ? (session ? `Bearer ${session}` : undefined) : name === 'x-image-token' ? grant : undefined };
    const res = { statusCode: 200, headers: {}, status(code) { this.statusCode = code; return this; },
      setHeader(name, value) { this.headers[name] = value; }, json(body) { this.body = body; } };
    await handlers[which](req, res); return res;
  } };
}
test('verification HTTP route uses signed identity and no-store; rejected PIN/session never issues grants', async () => {
  const f = fixture();
  assert.ok(source.indexOf("app.use('/api/outlets/:outletId', createWebUsageGuard(") < verification.pos);
  for (const action of ['bulk', 'shared', 'remove']) {
    for (const quickPin of ['', '9999']) {
      const res = await f.request('verify', { body: { action, quickPin } });
      assert.equal(res.statusCode, quickPin ? 422 : 400); assert.equal(res.body.data, undefined);
    }
    const res = await f.request('verify', { body: { action, quickPin: '1234' } });
    assert.equal(res.statusCode, 200); assert.equal(res.headers['Cache-Control'], 'no-store');
    assert.equal(res.body.data.action, action); assert.ok(res.body.data.imageToken);
  }
  for (const session of ['', 'forged', jwt.sign({ profileDocId: 'expired' }, key, { expiresIn: -1 })]) {
    assert.equal((await f.request('verify', { session, body: { action: 'remove', quickPin: '1234' } })).statusCode, 401);
  }
});
test('bulk removal HTTP route rejects missing/wrong-scope grants before writing and rechecks outlet permissions', async () => {
  const f = fixture(), body = { image: 'old.png', imagePath: null };
  for (const grant of [undefined, 'forged']) {
    assert.equal((await f.request('remove', { body, grant })).statusCode, 403);
    assert.equal((await f.request('remove', { grant })).statusCode, 403);
    assert.equal(f.writes.length, 0);
  }
  const verified = await f.request('verify', { body: { action: 'bulk', quickPin: '1234' } });
  assert.equal((await f.request('remove', { body, grant: verified.body.data.imageToken })).statusCode, 403);
  const result = await f.request('verify', { body: { action: 'remove', quickPin: '1234' } });
  const grant = result.body.data.imageToken;
  assert.equal((await f.request('remove', { body, grant })).statusCode, 200);
  assert.equal(f.writes.length, 1); assert.deepEqual(f.writes[0][4], body);
  f.profile.active = false;
  assert.equal((await f.request('remove', { body, grant })).statusCode, 403);
  f.profile.active = true; f.profile.outlets = ['foreign'];
  assert.equal((await f.request('remove', { body, grant })).statusCode, 403);
  assert.equal((await f.request('remove', { body, grant, session: '' })).statusCode, 401);
  assert.equal(f.writes.length, 1);
});
