import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../../backend/src/server.ts', import.meta.url), 'utf8');
const tree = ts.createSourceFile('server.ts', source, ts.ScriptTarget.Latest, true);
const route = tree.statements.find(n => ts.isExpressionStatement(n) && ts.isCallExpression(n.expression)
  && n.expression.expression.getText(tree) === 'app.get'
  && n.expression.arguments[0]?.text === '/api/outlets/:outletId/products/:documentId/edit-options');
assert.ok(route);
const js = ts.transpileModule(`const handler = ${route.expression.arguments[1].getText(tree)};`,
  { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.None } }).outputText;

async function request(kitchenId, name, denied = false) {
  const reads = [];
  const fields = { code: 1, kitchenId };
  const collection = (path) => ({
    doc: id => ({
      collection: child => collection(`${path}/${id}/${child}`),
      get: async () => {
        reads.push(`${path}/${id}`);
        return { exists: true, data: () => path.endsWith('/PRODUCT') ? fields : name === undefined ? undefined : { name } };
      },
    }),
  });
  const deps = {
    readAccessToken: () => ({ profileDocId: 'signed-profile' }),
    productImportDependencies: () => ({ readProfile: async () => ({}), readCategories: async () => [], readPremises: async () => [] }),
    requireProductOutlet: () => { if (denied) throw new Error('Access denied'); },
    assignedOutletIds: () => [],
    getFirestoreDb: () => ({ collection }),
    ProductCreationError: Error,
    ANDROID_TAX_OPTIONS: [], PRODUCT_UNITS: [],
    productCreationResponse: (res, error) => { res.error = error.message; },
  };
  const handler = new Function(...Object.keys(deps), `${js}; return handler;`)(...Object.values(deps));
  const res = { json(body) { this.body = body; } };
  await handler({ params: { outletId: 'selected-outlet', documentId: 'product-id' } }, res);
  return { reads, fields, res };
}

test('product editor resolves the service point document name within the authorized outlet and preserves kitchenId', async () => {
  const { reads, fields, res } = await request('service-point-id', 'Kitchen Printer');
  assert.deepEqual(reads, ['OUTLET/selected-outlet/PRODUCT/product-id', 'OUTLET/selected-outlet/SERVICE_POINT/service-point-id']);
  assert.equal(res.body.data.servicePointName, 'Kitchen Printer');
  assert.deepEqual(res.body.data.product.fields, fields);
  assert.equal(fields.kitchenId, 'service-point-id');
});

test('missing, invalid and deleted service points do not display raw IDs', async () => {
  for (const id of [undefined, null, '', 123, 'other/path', '.', '..']) {
    const { reads, res } = await request(id, 'Unrelated');
    assert.equal(res.body.data.servicePointName, '');
    assert.equal(reads.length, 1);
  }
  assert.equal((await request('deleted', undefined)).res.body.data.servicePointName, '');
  assert.equal((await request('bad-name', 123)).res.body.data.servicePointName, '');
});

test('denied outlet access prevents product and service point reads', async () => {
  const { reads, res } = await request('service-point-id', 'Kitchen Printer', true);
  assert.deepEqual(reads, []);
  assert.equal(res.error, 'Access denied');
});
