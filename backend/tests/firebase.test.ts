import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { test } from 'node:test';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { firebaseConfiguration, FirebaseConfigurationError, getFirestoreDb } from '../src/firebase.js';

// Synthetic key exists only in memory. These tests never request tokens or contact Firestore.
const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
  .export({ type: 'pkcs8', format: 'pem' }).toString();
const account = {
  type: 'service_account', project_id: 'pos-testing',
  client_email: 'tester@pos-testing.iam.gserviceaccount.com', private_key: privateKey
};
const testing = (overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(account),
  FIREBASE_TEST_PROJECT_ID: 'pos-testing', FIREBASE_PRODUCTION_PROJECT_ID: 'pos-production',
  ...overrides
});
const forbiddenRead = () => { throw new Error('JSON mode must not read a credential file'); };

test('valid JSON uses explicit testing project without file reads or remote calls', () => {
  const result = firebaseConfiguration(testing(), forbiddenRead);
  assert.equal(result.isolated, true);
  assert.equal(result.options.projectId, 'pos-testing');
  assert.ok(result.options.credential);
});

test('JSON credentials take precedence over a stale local file path', () => {
  assert.equal(firebaseConfiguration(testing({ GOOGLE_APPLICATION_CREDENTIALS: '/missing/local.json' }), forbiddenRead)
    .options.projectId, 'pos-testing');
});

test('escaped PEM newlines are accepted', () => {
  const result = firebaseConfiguration(testing({ FIREBASE_SERVICE_ACCOUNT_JSON:
    JSON.stringify({ ...account, private_key: privateKey.replace(/\n/g, '\\n') }) }), forbiddenRead);
  assert.equal(result.options.projectId, 'pos-testing');
});

test('missing, equal and malformed isolation IDs fail closed', () => {
  for (const overrides of [
    { FIREBASE_TEST_PROJECT_ID: '' }, { FIREBASE_PRODUCTION_PROJECT_ID: '' },
    { FIREBASE_PRODUCTION_PROJECT_ID: 'pos-testing' }, { FIREBASE_TEST_PROJECT_ID: 'pos.*testing' },
    { FIREBASE_PROJECT_ID: 'pos-production' }, { FIRESTORE_EMULATOR_HOST: 'localhost:8080' }
  ]) assert.throws(() => firebaseConfiguration(testing(overrides)), FirebaseConfigurationError);
});

test('production and foreign service accounts are rejected before Firebase initialization', () => {
  for (const fields of [
    { project_id: 'pos-production' }, { client_email: 'tester@pos-production.iam.gserviceaccount.com' },
    { type: 'authorized_user' }, { client_email: '' }, { private_key: undefined }
  ]) assert.throws(() => firebaseConfiguration(testing({ FIREBASE_SERVICE_ACCOUNT_JSON:
    JSON.stringify({ ...account, ...fields }) })), FirebaseConfigurationError);
});

test('invalid JSON, shapes and keys produce redacted configuration errors', () => {
  for (const source of ['', 'secret-value-not-json', 'null', '[]', '42',
    JSON.stringify({ ...account, private_key: 'secret-value-not-a-key' })]) {
    assert.throws(() => firebaseConfiguration(testing({ FIREBASE_SERVICE_ACCOUNT_JSON: source })), error => {
      assert.ok(error instanceof FirebaseConfigurationError);
      assert.ok(!String(error).includes('secret-value'));
      assert.ok(!String(error).includes('PRIVATE KEY'));
      return true;
    });
  }
});

test('testing file credentials receive the same project guard as JSON', () => {
  const env = testing({ GOOGLE_APPLICATION_CREDENTIALS: 'test.json' });
  delete env.FIREBASE_SERVICE_ACCOUNT_JSON;
  assert.equal(firebaseConfiguration(env, () => JSON.stringify(account)).options.projectId, 'pos-testing');
  assert.throws(() => firebaseConfiguration(env, () => JSON.stringify({ ...account, project_id: 'pos-production' })),
    FirebaseConfigurationError);
});

test('known testing deployment and Preview cannot use unguarded local credentials', () => {
  for (const deployment of [
    { VERCEL_PROJECT_PRODUCTION_URL: 'android-webpos-testing.vercel.app' }, { VERCEL_ENV: 'preview' }
  ]) assert.throws(() => firebaseConfiguration({ ...deployment, GOOGLE_APPLICATION_CREDENTIALS: 'test.json' }, forbiddenRead),
    /Testing Firebase is blocked/);
});

test('ordinary local file configuration retains ADC and the optional project override', () => {
  let path = '';
  const env = { GOOGLE_APPLICATION_CREDENTIALS: 'local.json', FIREBASE_PROJECT_ID: 'local-project' };
  const result = firebaseConfiguration(env, value => { path = value; return JSON.stringify(account); });
  assert.ok(path.endsWith('/backend/local.json'));
  assert.equal(env.GOOGLE_APPLICATION_CREDENTIALS, path);
  assert.equal(result.isolated, false);
  assert.equal(result.options.projectId, 'local-project');
});

test('missing credentials and unreadable files fail without exposing parser or filesystem details', () => {
  assert.throws(() => firebaseConfiguration({}), FirebaseConfigurationError);
  assert.throws(() => firebaseConfiguration({ GOOGLE_APPLICATION_CREDENTIALS: 'local.json' }, () => {
    throw new Error('secret-value');
  }), error => error instanceof FirebaseConfigurationError && !String(error).includes('secret-value'));
});

test('shared Firestore getter rejects missing isolation and pre-existing Admin apps without network access', async () => {
  const previous = { ...process.env };
  let app;
  try {
    Object.assign(process.env, testing());
    delete process.env.FIREBASE_TEST_PROJECT_ID;
    assert.throws(() => getFirestoreDb(), FirebaseConfigurationError);
    Object.assign(process.env, testing());
    app = initializeApp({ projectId: 'pos-production' });
    assert.throws(() => getFirestoreDb(), /unverified Firebase Admin app/);
  } finally {
    if (app) await deleteApp(app);
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});
