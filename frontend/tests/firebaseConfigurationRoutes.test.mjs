import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

// Exercise the actual handlers without starting Express or loading any credentials.
const source = readFileSync(new URL('../../backend/src/server.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('server.ts', source, ts.ScriptTarget.Latest, true);
class FirebaseConfigurationError extends Error {}

function handler(method, path, error) {
  const statement = ast.statements.find(node => ts.isExpressionStatement(node)
    && ts.isCallExpression(node.expression)
    && node.expression.expression.getText(ast) === `app.${method}`
    && node.expression.arguments[0]?.text === path);
  assert.ok(statement, `Missing ${method} ${path}`);
  const callback = statement.expression.arguments.at(-1);
  const code = ts.transpileModule(`const route = ${callback.getText(ast)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
  }).outputText;
  let reads = 0;
  const logs = [];
  const run = new Function('getFirebaseApp', 'FirebaseConfigurationError', 'getFirestoreDb', 'loginSchema', 'console', 'logFirebaseConfigurationError',
    `${code}\nreturn route;`)(
    () => { throw error; }, FirebaseConfigurationError,
    () => { reads++; throw new Error('Database access is forbidden in configuration failure tests'); },
    { safeParse: () => ({ success: true, data: { email: 'tester@example.invalid', quickPin: '1234' } }) },
    { error() { throw new Error('Raw configuration errors must not be logged'); } },
    (error, context) => logs.push({ error, context })
  );
  return { run, reads: () => reads, logs };
}

function response() {
  return { statusCode: 200, body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; } };
}

test('login reports the safe configuration reason and returns 503 without database access', async () => {
  const error = new FirebaseConfigurationError('Testing Firebase is blocked: FIREBASE_TEST_PROJECT_ID is missing.');
  const route = handler('post', '/api/auth/login', error);
  const res = response();
  await route.run({ body: {} }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.success, false);
  assert.equal(res.body.message, error.message);
  assert.equal(route.reads(), 0);
  assert.equal(res.body.data, undefined);
  assert.equal(route.logs.length, 1);
  assert.equal(route.logs[0].context, 'login');
  assert.equal(route.logs[0].error, error);
});

test('login keeps unexpected SDK/parser details out of its response', async () => {
  const route = handler('post', '/api/auth/login', new Error('secret-value-not-for-clients'));
  const res = response();
  await route.run({ body: {} }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.message, 'Firebase credentials or testing isolation are missing or invalid. Check the server configuration.');
  assert.equal(route.reads(), 0);
});

test('existing health endpoint reports a safe setup error without database access', () => {
  const error = new FirebaseConfigurationError('Testing Firebase is blocked: the project IDs are identical.');
  const route = handler('get', '/api/health', error);
  const res = response();
  route.run({}, res);
  assert.equal(res.body.firebase.initialized, false);
  assert.equal(res.body.firebase.message, error.message);
  assert.equal(route.reads(), 0);
});

test('existing health endpoint hides unexpected credential error details', () => {
  const route = handler('get', '/api/health', new Error('secret-value-not-for-clients'));
  const res = response();
  route.run({}, res);
  assert.equal(res.body.firebase.initialized, false);
  assert.ok(!res.body.firebase.message.includes('secret-value'));
  assert.equal(route.reads(), 0);
});
