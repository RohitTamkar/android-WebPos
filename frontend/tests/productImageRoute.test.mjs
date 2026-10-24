import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import jwt from '../../backend/node_modules/jsonwebtoken/index.js';
import { ProductCreationError, requireProductOutlet } from '../../backend/src/productCreation.ts';
import { FirebaseConfigurationError } from '../../backend/src/firebase.ts';
import { ImageStorageError, readMasterImage } from '../../backend/src/imageStorage.ts';

// Exercise the actual HTTP callback and authorization helpers without starting the
// server or initializing Firebase. All document and Storage reads are in memory.
const source = readFileSync(new URL('../../backend/src/server.ts', import.meta.url), 'utf8');
const tree = ts.createSourceFile('server.ts', source, ts.ScriptTarget.Latest, true);
const functionText = name => tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(tree);
const loop = tree.statements.find(node => ts.isForOfStatement(node) && node.initializer.getText(tree).includes('firestoreCollection'));
const route = loop.statement.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
  && node.expression.expression.getText(tree) === 'app.get');
assert.ok(route);
const key = 'isolated-image-route-session-key';
const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);

function fixture({ fields = { image: '1000014014.png' }, profile = { active: true, outlets: ['outlet'] }, missingObject = false, missingProduct = false } = {}) {
  const reads = [], storageReads = [];
  const ref = path => ({
    collection: id => ref(`${path}/${id}`), doc: id => ref(`${path}/${id}`),
    get: async () => {
      reads.push(path);
      const data = path === 'USER_PROFILE/signed' ? profile : fields;
      return { exists: path === 'USER_PROFILE/signed' || !missingProduct, data: () => data, get: field => data[field] };
    },
  });
  const bucket = { file: path => ({ getSignedUrl: async () => {
    storageReads.push(path);
    if (missingObject) throw new Error('private storage error');
    return [`data:image/png;base64,${bytes.toString('base64')}`];
  } }) };
  const dependencies = { jwt, JWT_SECRET: key, ProductCreationError, requireProductOutlet, FirebaseConfigurationError,
    ImageStorageError, readMasterImage, getFirestoreDb: () => ({ collection: id => ref(id) }), getFirebaseStorageBucket: () => bucket };
  const js = ts.transpileModule([
    ...['readAccessToken', 'assignedOutletIds', 'authorizeImageTarget', 'imageApiError'].map(functionText),
    `const imageKind = 'products'; const firestoreCollection = 'PRODUCT'; const handler = ${route.expression.arguments[1].getText(tree)};`,
  ].join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.None } }).outputText;
  const handler = new Function(...Object.keys(dependencies), `${js}; return handler;`)(...Object.values(dependencies));
  return { reads, storageReads, async request({ token = jwt.sign({ profileDocId: 'signed' }, key), outletId = 'outlet' } = {}) {
    const req = { params: { outletId, documentId: 'product' }, header: name => name === 'authorization' && token ? `Bearer ${token}` : undefined };
    const res = { statusCode: 200, headers: {}, setHeader(name, value) { this.headers[name] = value; },
      status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; }, send(body) { this.body = body; } };
    await handler(req, res); return res;
  } };
}

test('authenticated image GET resolves filename and legacy references and returns actual bytes and content type', async () => {
  const legacy = 'sensible_images/OUTLET/outlet/PRODUCT_IMAGES/product/abc123.png';
  for (const [fields, expected] of [[{ image: '1000014014.png' }, 'product_images/1000014014.png'], [{ image: legacy }, legacy], [{ imagePath: legacy }, legacy]]) {
    const f = fixture({ fields }); const response = await f.request();
    assert.equal(response.statusCode, 200); assert.deepEqual(response.body, bytes);
    assert.equal(response.headers['Content-Type'], 'image/png');
    assert.equal(response.headers['Cache-Control'], 'private, no-store');
    assert.equal(response.headers['X-Content-Type-Options'], 'nosniff');
    assert.deepEqual(f.storageReads, [expected]);
    assert.deepEqual(f.reads, ['USER_PROFILE/signed', 'OUTLET/outlet/PRODUCT/product'], 'Each preview reads the authorized product once');
  }
});

test('missing sessions, forged tokens, inactive accounts and foreign outlets cannot read image bytes', async () => {
  for (const token of ['', 'forged', jwt.sign({ profileDocId: 'signed' }, key, { expiresIn: -1 })]) {
    const f = fixture(); assert.equal((await f.request({ token })).statusCode, 401);
    assert.deepEqual(f.reads, []); assert.deepEqual(f.storageReads, []);
  }
  for (const profile of [{ active: false, outlets: ['outlet'] }, { active: true, outlets: ['other'] }]) {
    const f = fixture({ profile }); assert.equal((await f.request()).statusCode, 403);
    assert.deepEqual(f.reads, ['USER_PROFILE/signed']); assert.deepEqual(f.storageReads, []);
  }
});

test('missing products, absent images, invalid paths and unavailable objects return safe errors', async () => {
  for (const options of [{ missingProduct: true }, { fields: {} }, { fields: { image: '../other.png' } }, { missingObject: true }]) {
    const f = fixture(options); const response = await f.request();
    assert.equal(response.statusCode, 404); assert.equal(response.body.success, false);
    assert.ok(!response.body.message.includes('private storage error'));
  }
});
