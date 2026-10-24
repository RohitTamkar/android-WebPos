import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import jwt from '../../backend/node_modules/jsonwebtoken/index.js';
import { requireProductImageAuthorization, verifyProductImagePin } from '../../backend/src/productImageAuthorization.ts';
import { ProductCreationError } from '../../backend/src/productCreation.ts';
import { FirebaseConfigurationError } from '../../backend/src/firebase.ts';
import { ImageStorageError } from '../../backend/src/imageStorage.ts';

const source = readFileSync(new URL('../../backend/src/server.ts', import.meta.url), 'utf8');
const tree = ts.createSourceFile('server.ts', source, ts.ScriptTarget.Latest, true);
const functionText = name => tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(tree);
const route = tree.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
  && node.expression.expression.getText(tree) === 'app.post' && node.expression.arguments[0]?.text === '/api/outlets/:outletId/product-image-assignments');
const key = 'image-assignment-test-session-key';
const imageKey = 'image-assignment-test-grant-key-12345';
let grant;
const db = { collection: () => ({ doc: () => ({ get: async () => ({ data: () => ({ active: true, outlets: ['authorized-outlet'], quickPin: '1234' }) }) }) }) };
const session = jwt.sign({ profileDocId: 'signed-user' }, key);
grant = (await verifyProductImagePin(db, 'authorized-outlet', 'signed-user', p => p.outlets, imageKey, `Bearer ${session}`, { action: 'bulk', quickPin: '1234' })).imageToken;
function fixture(error) {
  const calls = [], db = {}, bucket = {};
  const dependencies = { jwt, JWT_SECRET: key, IMAGE_JWT_SECRET: imageKey, requireProductImageAuthorization, ProductCreationError, ImageStorageError, FirebaseConfigurationError,
    getFirestoreDb: () => db, getFirebaseStorageBucket: () => bucket,
    assignProductImage: async (...args) => { calls.push(args); if (error) throw error; return { image: 'verified.png', results: [] }; } };
  const js = ts.transpileModule([...['readAccessToken', 'assignedOutletIds', 'imageApiError'].map(functionText),
    `const handler = ${route.expression.arguments[1].getText(tree)};`].join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.None } }).outputText;
  const handler = new Function(...Object.keys(dependencies), `${js}; return handler;`)(...Object.values(dependencies));
  return { calls, async request(token = session, body = { targets: ['reviewed'] }, imageGrant = grant) {
    const req = { params: { outletId: 'authorized-outlet' }, body, header: name => name === 'authorization' && token ? `Bearer ${token}` : name === 'x-image-token' ? imageGrant : undefined };
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } };
    await handler(req, res); return res;
  } };
}
test('image assignment keeps the usage guard and signed identity; no caller-selected Storage path is introduced', async () => {
  assert.ok(source.indexOf("app.use('/api/outlets/:outletId', createWebUsageGuard(") < route.pos);
  const f = fixture(); const response = await f.request();
  assert.equal(response.statusCode, 200); assert.equal(f.calls[0][2], 'authorized-outlet'); assert.equal(f.calls[0][3], 'signed-user');
  assert.deepEqual(f.calls[0][5], { targets: ['reviewed'] });
});
test('missing, forged and expired JWTs cannot reach the assignment service', async () => {
  for (const token of ['', 'forged', jwt.sign({ profileDocId: 'user' }, key, { expiresIn: -1 })]) {
    const f = fixture(); assert.equal((await f.request(token)).statusCode, 401); assert.equal(f.calls.length, 0);
  }
});
test('authorization, byte-limit and verification errors do not produce success', async () => {
  for (const error of [new ProductCreationError(403, 'Unauthorized outlet'), new ImageStorageError(413, 'Image too large'), new ImageStorageError(503, 'Verification failed')]) {
    const response = await fixture(error).request(); assert.equal(response.statusCode, error.status); assert.equal(response.body.success, false);
  }
});

test('the existing single-image route forwards retry IDs and reviewed references without changing raw bytes', async () => {
  const loop = tree.statements.find(node => ts.isForOfStatement(node) && node.initializer.getText(tree).includes('firestoreCollection'));
  const put = loop.statement.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
    && node.expression.expression.getText(tree) === 'app.put');
  const calls = [], bytes = Buffer.from([137, 80, 78, 71]);
  const dependencies = { ProductCreationError, ImageStorageError, FirebaseConfigurationError,
    authorizeImageTarget: async () => ({ db: {}, outletId: 'o', documentId: 'p' }),
    getFirebaseStorageBucket: () => ({}), uploadMasterImage: async (...args) => { calls.push(args); return { image: 'verified.png' }; } };
  const js = ts.transpileModule(`${functionText('imageApiError')}\nconst imageKind='products', firestoreCollection='PRODUCT'; const handler=${put.expression.arguments[2].getText(tree)};`,
    { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.None } }).outputText;
  const handler = new Function(...Object.keys(dependencies), `${js}; return handler;`)(...Object.values(dependencies));
  const invoke = async expected => {
    const headers = { 'content-type': 'image/png', 'x-image-upload-id': '10000000-0000-4000-8000-000000000001', 'x-image-expected-reference': expected };
    const req = { body: bytes, header: name => headers[name.toLowerCase()] };
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } };
    await handler(req, res); return res;
  };
  assert.equal((await invoke('"legacy/path"')).statusCode, 200);
  assert.equal(calls[0][5], bytes);
  assert.deepEqual(calls[0][7], { requestId: '10000000-0000-4000-8000-000000000001', expectedReference: 'legacy/path' });
  for (const invalid of ['', '{bad', '{"path":"unreviewed"}']) {
    assert.equal((await invoke(invalid)).statusCode, 400);
  }
  assert.equal(calls.length, 1);
});

 test('missing, forged, wrong-session and expired image grants cannot call assignment service', async () => {
   for (const value of [undefined, 'forged', jwt.sign({ outletId: 'authorized-outlet', action: 'bulk', session: 'wrong' }, imageKey, { subject: 'signed-user', audience: 'product-image-management', expiresIn: -1 })]) {
     const f = fixture(); const response = await f.request(session, {}, value ?? '');
     assert.equal(response.statusCode, 403); assert.equal(f.calls.length, 0);
   }
 });
