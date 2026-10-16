import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createInMemoryProductImportQuota, ProductImportQuotaError, UPLOAD_WINDOW_MS } from '../../backend/src/productImportQuota.ts';

// Execute only the actual confirmation route. Do not load the server, Firebase,
// credentials, or any database client. All import dependencies are isolated fakes.
const source = readFileSync(new URL('../../backend/src/server.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('server.ts', source, ts.ScriptTarget.Latest, true);
const route = ast.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
  && node.expression.expression.getText(ast) === 'app.post'
  && node.expression.arguments[0]?.text === '/api/outlets/:outletId/products/import');
assert.ok(route);
const code = ts.transpileModule(`const handler = ${route.expression.arguments[1].getText(ast)};`, {
  compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.None },
}).outputText;

function fixture({ status = 200, writesEnabled = true, persist } = {}) {
  const acceptedAt = Date.parse('2026-10-16T12:00:00Z');
  const writes = [];
  const authorizations = [];
  const dependencies = {
    readAccessToken: req => req.user ? { profileDocId: req.user } : null,
    checkAuthorizedProductImport: async (profile, outlet, file) => {
      authorizations.push({ profile, outlet, file });
      if (!profile) return { status: 401, body: { success: false, message: 'Unauthorized' } };
      if (status !== 200) return { status, body: { success: false, message: 'Rejected before acceptance' } };
      return { status: 200, body: { data: { canUpload: true, documents: [{ rowNumber: 2, fields: { code: 1 } }] } } };
    },
    productImportDependencies: () => ({}),
    PRODUCT_IMPORT_WRITES_ENABLED: writesEnabled,
    productImportQuota: createInMemoryProductImportQuota(() => acceptedAt),
    ProductImportQuotaError,
    persistProductImport: async (...args) => {
      writes.push(args);
      return persist ? persist(...args) : { success: true, created: 1, existing: 0, confirmedRows: [2], unconfirmedRows: [] };
    },
    getFirestoreDb: () => { throw new Error('Route quota test must never access Firestore'); },
    createProductImportChunk: () => { throw new Error('Route quota test must never create products'); },
  };
  const handler = new Function(...Object.keys(dependencies), `${code}\nreturn handler;`)(...Object.values(dependencies));
  async function request(file, { outlet = 'authorized-outlet', user = 'user-a', codes = [1] } = {}) {
    let httpStatus = 200;
    let body;
    const headers = {};
    await handler({ user, params: { outletId: outlet }, body: { source: file, codes } }, {
      setHeader(name, value) { headers[name] = value; },
      status(value) { httpStatus = value; return this; },
      json(value) { body = value; },
    });
    return { status: httpStatus, body, headers };
  }
  return { request, writes, authorizations, acceptedAt };
}

test('confirmation gate returns 429 and retry time before invoking a third persistence call', async () => {
  const f = fixture();
  assert.equal((await f.request('one')).status, 200);
  assert.equal((await f.request('two')).status, 200);
  const rejected = await f.request('three');
  assert.equal(rejected.status, 429);
  assert.equal(rejected.body.success, false);
  assert.match(rejected.body.message, /limit of 2/);
  assert.equal(rejected.body.nextAvailableAt, new Date(f.acceptedAt + UPLOAD_WINDOW_MS).toISOString());
  assert.equal(Number(rejected.headers['Retry-After']), UPLOAD_WINDOW_MS / 1000);
  assert.equal(f.writes.length, 2);
});

test('authentication and preview-code failures do not consume acceptance slots', async () => {
  const f = fixture();
  assert.equal((await f.request('unauthorized', { user: null })).status, 401);
  assert.equal((await f.request('stale-preview', { codes: [999] })).status, 409);
  assert.equal(f.writes.length, 0);
  assert.equal((await f.request('one')).status, 200);
  assert.equal((await f.request('two')).status, 200);
  assert.equal((await f.request('three')).status, 429);
  assert.equal(f.writes.length, 2);
});

test('existing outlet/validation failures and write-disable guard remain authoritative', async () => {
  for (const status of [403, 422]) {
    const f = fixture({ status });
    assert.equal((await f.request('file')).status, status);
    assert.equal(f.writes.length, 0);
  }
  const disabled = fixture({ writesEnabled: false });
  assert.equal((await disabled.request('file')).status, 403);
  assert.equal(disabled.writes.length, 0);
});

test('different authorized users share one outlet quota and different outlets remain independent', async () => {
  const f = fixture();
  await f.request('one', { user: 'user-a' });
  await f.request('two', { user: 'user-b' });
  assert.equal((await f.request('three', { user: 'user-c' })).status, 429);
  assert.equal((await f.request('three', { user: 'user-c', outlet: 'another-authorized-outlet' })).status, 200);
  assert.deepEqual(f.authorizations.map(entry => entry.profile), ['user-a', 'user-b', 'user-c', 'user-c']);
  assert.deepEqual(f.writes.map(args => args[0]), ['authorized-outlet', 'authorized-outlet', 'another-authorized-outlet']);
});

test('concurrent route requests cannot race the same outlet acceptance check', async () => {
  const f = fixture();
  const results = await Promise.all(Array.from({ length: 20 }, (_, index) => f.request(`file-${index}`)));
  assert.equal(results.filter(result => result.status === 200).length, 2);
  assert.equal(results.filter(result => result.status === 429).length, 18);
  assert.equal(f.writes.length, 2);
});

test('concurrent identical retries are reauthorized but invoke persistence once', async () => {
  const f = fixture();
  const results = await Promise.all(Array.from({ length: 10 }, (_, index) => f.request('same-file', { user: `user-${index}` })));
  assert.ok(results.every(result => result.status === 200));
  assert.equal(f.writes.length, 1);
  assert.equal(f.authorizations.length, 10);
  await f.request('second-file');
  assert.equal((await f.request('third-file')).status, 429);
});

test('partial results and exceptions retain acceptance while preserving existing response conventions', async () => {
  let partial = true;
  const f = fixture({ persist: async () => partial
    ? { success: false, created: 100, existing: 0, confirmedRows: [2], unconfirmedRows: [3], message: 'Partial' }
    : { success: true, created: 1, existing: 100, confirmedRows: [2, 3], unconfirmedRows: [] } });
  assert.equal((await f.request('partial-file')).status, 503);
  partial = false;
  await f.request('second-file');
  assert.equal((await f.request('third-file')).status, 429);
  assert.equal((await f.request('partial-file')).status, 200);
  assert.equal(f.writes.length, 3);
  const failing = fixture({ persist: async () => { throw new Error('Unknown persistence outcome'); } });
  assert.equal((await failing.request('one')).status, 409);
  assert.equal((await failing.request('two')).status, 409);
  assert.equal((await failing.request('three')).status, 429);
});
