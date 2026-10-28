import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { ProductCreationError } from '../../backend/src/productCreation.js';
import { checkAuthorizedProductImport } from '../../backend/src/productImportValidation.ts';
import ts from 'typescript';
import { PRODUCT_COLUMNS, parseProductCsv, namedPremisesHeaders } from '../src/pages/productCsvPreview.ts';
import { createInMemoryProductImportQuota, ProductImportQuotaError, PRODUCT_UPLOAD_WINDOW_MS } from '../../backend/src/productImportQuota.ts';

// Execute only the actual confirmation route. Do not load the server, Firebase,
// credentials, or any database client. All import dependencies are isolated fakes.
const source = readFileSync(new URL('../../backend/src/server.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('server.ts', source, ts.ScriptTarget.Latest, true);
const route = ast.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
  && node.expression.expression.getText(ast) === 'app.post'
  && ts.isArrayLiteralExpression(node.expression.arguments[0])
  && node.expression.arguments[0].elements.some(element => element.text === '/api/outlets/:outletId/products/import'));
assert.ok(route);
const validationRoute = ast.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
  && node.expression.expression.getText(ast) === 'app.post'
  && node.expression.arguments[0]?.text === '/api/outlets/:outletId/products/import/validate');
assert.ok(validationRoute);
const code = ts.transpileModule(`const handler = ${route.expression.arguments[1].getText(ast)};`, {
  compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.None },
}).outputText;

function fixture({ status = 200, writesEnabled = true, persist } = {}) {
  const acceptedAt = Date.parse('2026-10-16T12:00:00Z');
  const writes = [];
  const authorizations = [];
  const dependencies = {
    readAccessToken: req => req.user ? { profileDocId: req.user } : null,
    checkAuthorizedProductImport: async (profile, outlet, file, deps, acceptAttempt, mode = 'standard') => {
      authorizations.push({ profile, outlet, file, mode });
      if (!profile) return { status: 401, body: { success: false, message: 'Unauthorized' } };
      if (status !== 403) acceptAttempt?.();
      if (status !== 200) return { status, body: { success: false, message: 'Rejected before acceptance' } };
      if (mode === 'premises') {
        try {
          const preview = parseProductCsv(file, 'premises');
          if (preview.headerErrors.length || !namedPremisesHeaders(preview.headers).length || preview.rows.some(row => row.errors.length)) return { status: 422, body: { success: false } };
        } catch { return { status: 422, body: { success: false } }; }
      }
      return { status: 200, body: { data: { canUpload: true, documents: [{ rowNumber: 2, fields: { code: 1 } }] } } };
    },
    productImportDependencies: () => ({}),
    PRODUCT_IMPORT_WRITES_ENABLED: writesEnabled,
    productImportQuota: createInMemoryProductImportQuota(() => acceptedAt),
    ProductImportQuotaError, ProductCreationError,
    persistProductImportWithCategories: async (...args) => {
      writes.push(args);
      return persist ? persist(...args) : { success: true, created: 1, existing: 0, confirmedRows: [2], unconfirmedRows: [] };
    },
    getFirestoreDb: () => { throw new Error('Route quota test must never access Firestore'); },
    createProductImportChunk: () => { throw new Error('Route quota test must never create products'); },
  };
  const handler = new Function(...Object.keys(dependencies), `${code}\nreturn handler;`)(...Object.values(dependencies));
  const validateCode = ts.transpileModule(`const handler = ${validationRoute.expression.arguments[1].getText(ast)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.None },
  }).outputText;
  const validate = new Function(...Object.keys(dependencies), `${validateCode}; return handler;`)(...Object.values(dependencies));
  async function request(file, { outlet = 'authorized-outlet', user = 'user-a', codes = [1], type = 'standard', filename = 'products.csv', routePath } = {}) {
    let httpStatus = 200;
    let body;
    const headers = {};
    const path = routePath ?? `/api/outlets/${outlet}/products/import${type === 'premises' ? '/premises' : type === 'validate' ? '/validate' : ''}`;
    await (type === 'validate' ? validate : handler)({ user, path, params: { outletId: outlet }, body: { source: file, codes, filename } }, {
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
  assert.match(rejected.body.message, /Upload limit reached/);
  assert.equal(rejected.body.nextAvailableAt, new Date(f.acceptedAt + PRODUCT_UPLOAD_WINDOW_MS).toISOString());
  assert.equal(Number(rejected.headers['Retry-After']), PRODUCT_UPLOAD_WINDOW_MS / 1000);
  assert.equal(f.writes.length, 2);
});

test('unauthorized requests are free; stale preview codes consume an attempt', async () => {
  const f = fixture();
  assert.equal((await f.request('unauthorized', { user: null })).status, 401);
  assert.equal((await f.request('stale-preview', { codes: [999] })).status, 409);
  assert.equal(f.writes.length, 0);
  assert.equal((await f.request('one')).status, 200);
  assert.equal((await f.request('two')).status, 429);
  assert.equal(f.writes.length, 1);
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

test('concurrent identical retries each count and only two reach persistence', async () => {
  const f = fixture();
  const results = await Promise.all(Array.from({ length: 10 }, (_, index) => f.request('same-file', { user: `user-${index}` })));
  assert.equal(results.filter(result => result.status === 200).length, 2);
  assert.equal(results.filter(result => result.status === 429).length, 8);
  assert.equal(f.writes.length, 2);
  assert.equal(f.authorizations.length, 10);
});

test('invalid files and disabled writes consume authorized attempts', async () => {
  for (const options of [{ status: 422 }, { writesEnabled: false }]) {
    const f = fixture(options);
    await f.request('same-file');
    await f.request('same-file');
    assert.equal((await f.request('same-file')).status, 429);
    assert.equal(f.writes.length, 0);
  }
  const denied = fixture({ status: 403 });
  for (let i = 0; i < 3; i++) assert.equal((await denied.request('same-file')).status, 403);
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
  assert.equal((await f.request('partial-file')).status, 429);
  assert.equal(f.writes.length, 2);
  const failing = fixture({ persist: async () => { throw new Error('Unknown persistence outcome'); } });
  assert.equal((await failing.request('one')).status, 409);
  assert.equal((await failing.request('two')).status, 409);
  assert.equal((await failing.request('three')).status, 429);
});

// Exercise the real authorization/validation boundary without any database client.
test('real authorization precedes acceptance and invalid source consumes a slot before validation', async () => {
  const quota = createInMemoryProductImportQuota();
  const deps = {
    readProfile: async id => id === 'inactive' ? { active: false } : { active: true },
    assignedOutlets: () => ['outlet'],
    readCategories: async () => { throw new Error('No category reads expected'); },
    readTaxes: async () => { throw new Error('No tax reads expected'); },
    readProducts: async () => { throw new Error('No product reads expected'); },
  };
  const check = (user, outlet, source, accept = () => quota.accept(outlet)) =>
    checkAuthorizedProductImport(user, outlet, source, deps, accept);
  assert.equal((await check(null, 'outlet', null)).status, 401);
  assert.equal((await check('inactive', 'outlet', null)).status, 403);
  assert.equal((await check('user', 'other-outlet', null)).status, 403);
  // Preview calls omit acceptance and cannot exhaust the upload limit.
  for (let i = 0; i < 4; i++) assert.equal((await check('user', 'outlet', null, undefinedCallback)).status, 400);
  assert.equal((await check('user', 'outlet', null)).status, 400);
  assert.equal((await check('user', 'outlet', 'invalid CSV')).status, 422);
  await assert.rejects(check('user', 'outlet', 'invalid CSV'), ProductImportQuotaError);
});
const undefinedCallback = () => {};

test('frontend preview and confirmation send separate requests with exactly one import request', async () => {
  const text = readFileSync(new URL('../src/pages/CsvUploadPreview.tsx', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('CsvUploadPreview.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let upload;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'upload') upload = node.initializer.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(upload);
  const js = ts.transpileModule(`const upload = ${upload};`, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.None } }).outputText;
  const calls = [];
  let codes = null;
  let limitMessage = null;
  const deps = {
    mode: 'standard', busyRef: { current: false }, uploaded: false, source: 'CSV',
    preview: { headerErrors: [], rows: [{ rowNumber: 2, errors: [] }] },
    assignedCodes: null, outletId: 'outlet', token: 'token', requestRef: { current: null },
    setUploading() {}, setError(message) { if (message) throw new Error(message); }, setUploadStatus() {},
    setUploadLimitMessage(value) { limitMessage = value; },
    checkQuota: async () => false, setAssignedCodes(value) { codes = value; }, setUploaded() {}, setPreview() {}, onSessionExpired() {},
    successDialogRef: { current: { showModal() {} } },
    fetch: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return { ok: true, status: 200, json: async () => url.endsWith('/validate')
        ? { data: { canUpload: true, documents: [{ fields: { code: 1 } }] } }
        : { success: true, data: { success: true, message: 'Done' } } };
    },
  };
  const run = () => new Function(...Object.keys(deps), `${js}; return upload();`)(...Object.values(deps));
  await run();
  assert.deepEqual(codes, [1]);
  deps.assignedCodes = codes;
  await run();
  assert.deepEqual(calls.map(call => call.url), ['/api/outlets/outlet/products/import/validate', '/api/outlets/outlet/products/import']);
  assert.deepEqual(calls[1].body.codes, [1]);
  deps.fetch = async () => ({ ok: false, status: 429, json: async () => ({ message: 'Upload limit reached' }) });
  await run();
  assert.equal(limitMessage, 'Upload limit reached');
  assert.match(text, /if \(uploadLimitMessage\) return <p className="csv-upload-error" role="alert">\{uploadLimitMessage\}<\/p>/);

});

test('quota status endpoint authorizes users and shares limits with imports without consuming attempts', async () => {
  const { requireProductOutlet, ProductCreationError } = await import('../../backend/src/productCreation.js');
  const route = ast.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
    && node.expression.expression.getText(ast) === 'app.get'
    && node.expression.arguments[0]?.text === '/api/outlets/:outletId/products/import/quota');
  assert.ok(route);
  const js = ts.transpileModule(`const handler = ${route.expression.arguments[1].getText(ast)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.None },
  }).outputText;
  const quota = createInMemoryProductImportQuota();
  const deps = {
    readAccessToken: req => req.user ? { profileDocId: req.user } : null,
    productImportDependencies: () => ({ readProfile: async id => ({ active: id !== 'inactive' }) }),
    requireProductOutlet, ProductCreationError, ProductImportQuotaError,
    assignedOutletIds: () => ['outlet'], productImportQuota: quota,
  };
  const handler = new Function(...Object.keys(deps), `${js}; return handler;`)(...Object.values(deps));
  async function request(user = 'user-a', outletId = 'outlet') {
    const response = { statusCode: 200, body: null, headers: {},
      setHeader(key, value) { this.headers[key] = value; },
      status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } };
    await handler({ user, params: { outletId } }, response);
    return response;
  }
  assert.equal((await request(null)).statusCode, 401);
  assert.equal((await request('inactive')).statusCode, 403);
  assert.equal((await request('user-a', 'other')).statusCode, 403);
  for (let i = 0; i < 4; i++) assert.equal((await request()).statusCode, 200);
  assert.equal((await request()).body.remainingAttempts, 2);
  quota.accept('outlet');
  for (const user of ['user-a', 'user-b', 'user-a']) {
    const reopened = await request(user);
    assert.equal(reopened.body.remainingAttempts, 1);
    assert.equal(reopened.body.maxAttempts, 2);
  }
  quota.accept('outlet');
  const otherUser = await request('user-b');
  assert.equal(otherUser.statusCode, 429);
  assert.match(otherUser.body.message, /Upload limit reached/);
  assert.equal(otherUser.headers['Cache-Control'], 'no-store');
  assert.ok(otherUser.headers['Retry-After']);
});

test('frontend quota check blocks preview for an exhausted outlet before file selection', async () => {
  const source = readFileSync(new URL('../src/pages/CsvUploadPreview.tsx', import.meta.url), 'utf8');
  const tree = ts.createSourceFile('preview.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'checkQuota') callback = node.initializer.arguments[0].getText(tree);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  const js = ts.transpileModule(`const check = ${callback};`, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.None } }).outputText;
  let message = ''; let checked = false; let remaining;
  const deps = { outletId: 'outlet', token: 'token', onSessionExpired() {},
    fetch: async () => ({ status: 429, ok: false, json: async () => ({ message: 'Limit reached' }) }),
    setRemainingAttempts(value) { remaining = value; },
    setUploadLimitMessage(value) { message = value; }, setQuotaChecked(value) { checked = value; },
    setError(value) { throw new Error(value); } };
  const check = new Function(...Object.keys(deps), `${js}; return check;`)(...Object.values(deps));
  assert.equal(await check(), false);
  assert.equal(message, 'Limit reached'); assert.equal(checked, false);
  deps.fetch = async () => ({ status: 200, ok: true, json: async () => ({ success: true, remainingAttempts: 1 }) });
  const unlocked = new Function(...Object.keys(deps), `${js}; return check;`)(...Object.values(deps));
  assert.equal(await unlocked(), true);
  assert.equal(message, ''); assert.equal(checked, true); assert.equal(remaining, 1);
});

test('standard and premises import endpoints use one combined two-attempt outlet limit in either order', async () => {
  for (const types of [['standard', 'standard'], ['premises', 'premises'], ['standard', 'premises'], ['premises', 'standard']]) {
    const f = fixture();
    for (const type of types) {
      const response = await f.request('identical-content', { type });
      assert.equal(response.status, type === 'premises' ? 422 : 200);
      if (type === 'premises') assert.equal(response.body.success, false);
    }
    for (const type of ['standard', 'premises']) {
      const response = await f.request('identical-content', { type, filename: 'renamed-copy.csv', user: 'another-user' });
      assert.equal(response.status, 429);
      assert.equal(response.body.nextAvailableAt, new Date(f.acceptedAt + PRODUCT_UPLOAD_WINDOW_MS).toISOString());
    }
    assert.equal(f.writes.length, types.filter(type => type === 'standard').length);
  }
});

test('validation is non-consuming; each actual upload, renamed duplicate and retry consumes once', async () => {
  const f = fixture();
  for (let i = 0; i < 4; i++) assert.equal((await f.request('same-file', { type: 'validate' })).status, 200);
  assert.equal((await f.request('same-file')).status, 200);
  assert.equal((await f.request('same-file', { type: 'validate' })).status, 200);
  assert.equal((await f.request('same-file', { type: 'premises', filename: 'renamed.csv' })).status, 422);
  assert.equal((await f.request('same-file', { type: 'validate' })).status, 429);
  assert.equal((await f.request('same-file')).status, 429);
  assert.equal(f.writes.length, 1);
});

test('unauthorized requests through either endpoint consume nothing; other outlets keep independent slots', async () => {
  const f = fixture();
  for (const type of ['standard', 'premises']) assert.equal((await f.request('file', { type, user: null })).status, 401);
  await f.request('file', { type: 'premises' });
  await f.request('file', { type: 'standard', user: 'another-user' });
  assert.equal((await f.request('file', { type: 'premises' })).status, 429);
  assert.equal((await f.request('file', { type: 'premises', outlet: 'second-outlet' })).status, 422);
  assert.equal((await f.request('file', { type: 'standard', outlet: 'second-outlet' })).status, 200);
  const forbidden = fixture({ status: 403 });
  for (let i = 0; i < 4; i++) assert.equal((await forbidden.request('file', { type: i % 2 ? 'premises' : 'standard' })).status, 403);
});

test('simultaneous requests across both endpoints cannot exceed two accepted attempts', async () => {
  const f = fixture();
  const results = await Promise.all(Array.from({ length: 20 }, (_, index) => f.request('same-file', { type: index % 2 ? 'standard' : 'premises' })));
  assert.equal(results.filter(result => result.status !== 429).length, 2);
  assert.equal(results.filter(result => result.status === 429).length, 18);
  assert.equal(f.writes.length, 1);
});

test('deleting products cannot reset the shared upload quota', async () => {
  const products = new Set();
  const f = fixture({ persist: async () => { products.add('product'); return { success: true, created: 1 }; } });
  await f.request('one'); await f.request('two', { type: 'premises' });
  products.clear();
  assert.equal((await f.request('three')).status, 429);
  assert.equal((await f.request('three', { type: 'premises' })).status, 429);
});


test('premises route casing and trailing slashes cannot fall back to the standard writer', async () => {
  for (const routePath of ['/api/outlets/authorized-outlet/products/import/premises/', '/api/outlets/authorized-outlet/products/import/PREMISES']) {
    const f = fixture();
    assert.equal((await f.request('standard-shaped-file', { type: 'premises', routePath })).status, 422);
    assert.equal((await f.request('standard-shaped-file')).status, 200);
    assert.equal((await f.request('standard-shaped-file', { type: 'premises', routePath })).status, 429);
    assert.equal(f.writes.length, 1);
  }
});


test('named premises confirmation routes through the premises mode and shares the outlet quota', async () => {
  const f = fixture();
  const file = [[...PRODUCT_COLUMNS, 'AC Table', 'Non AC Table'],
    ['Product', 'Local', '20', '20', '0', '0', 'Food', '1', '0', '0', 'number', '0', 'no', '', '25.50', '0']].map(row => row.join(',')).join('\n');
  assert.equal((await f.request(file, { type: 'premises' })).status, 200);
  assert.equal(f.authorizations[0].mode, 'premises');
  assert.equal(f.writes[0].at(-1), 'premises');
  assert.equal((await f.request('standard')).status, 200);
  assert.equal((await f.request(file, { type: 'premises' })).status, 429);
});
