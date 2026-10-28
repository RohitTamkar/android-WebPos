import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PRODUCT_COLUMNS } from '../../frontend/src/pages/productCsvPreview.js';
import { checkAuthorizedProductImport } from '../src/productImportValidation.js';
import { createProductImportChunk } from '../src/productImportWriter.js';
const headers = [...PRODUCT_COLUMNS, 'AC Table', 'Non AC Table'];
const source = [headers, ['Chicken', 'Local', '20', '20', '0', '0', 'Food', '1', '0', '0', 'number', '0', 'no', '', '25.50', '0']].map(cells => cells.join(',')).join('\n');
const assigned = () => ['outlet'];
const deps = { readProfile: async () => ({ active: true }), assignedOutlets: assigned,
    readCategories: async () => [{ id: 'cat', name: 'Food', categoryNo: 1 }], readTaxes: async () => [{ percent: 0, index: 1, type: 0 }], readProducts: async () => [] };
async function documents() {
    const result = await checkAuthorizedProductImport('user', 'outlet', source, deps, undefined, 'premises');
    assert.equal(result.status, 200);
    return result.body.data.documents;
}
function fixture() {
    const records = new Map([
        ['USER_PROFILE/user', { active: true }], ['OUTLET/outlet', { active: true }],
        ['OUTLET/outlet/CATEGORY/cat', { name: 'Food', categoryNo: 1 }],
        ['OUTLET/outlet/PREMISES/ac', { name: ' ac table ', code: 4, type: 'Table', tables: 30 }],
    ]);
    let writes = 0, version = 0;
    const ref = (path) => ({ path, doc: (id) => ref(`${path}/${id}`), collection: (name) => ref(`${path}/${name}`) });
    const snapshot = (path, fields) => ({ id: path.split('/').at(-1), data: () => ({ ...fields }) });
    const db = { collection: (name) => ref(name), runTransaction: async (work) => {
            for (;;) {
                const startVersion = version;
                const pending = [];
                const result = await work({ get: async ({ path }) => {
                        assert.equal(pending.length, 0, 'all transaction reads precede writes');
                        if (path.split('/').length % 2 === 0)
                            return { data: () => records.get(path) };
                        return { docs: [...records].filter(([key]) => key.startsWith(`${path}/`) && key.split('/').length === path.split('/').length + 1).map(([key, fields]) => snapshot(key, fields)) };
                    }, create: ({ path }, fields) => pending.push({ path, fields }) });
                if (version !== startVersion)
                    continue;
                for (const write of pending)
                    assert.ok(!records.has(write.path), 'never overwrite an existing record');
                for (const write of pending) {
                    records.set(write.path, write.fields);
                    writes++;
                }
                if (pending.length)
                    version++;
                return result;
            }
        } };
    return { db, records, writes: () => writes };
}
const context = { names: ['AC Table', 'Non AC Table'], profileId: 'user', assigned };
test('validation builds Android priceTable and remains read-only; standard upload rejects extra columns', async () => {
    const docs = await documents();
    assert.deepEqual(JSON.parse(String(docs[0].fields.priceTable)), { 'default price': 20, 'AC Table price': 25.5, 'Non AC Table price': 0 });
    assert.ok((await checkAuthorizedProductImport('user', 'outlet', source, deps)).status >= 400);
    assert.equal((await checkAuthorizedProductImport(null, 'outlet', source, deps, undefined, 'premises')).status, 401);
    assert.equal((await checkAuthorizedProductImport('user', 'other', source, deps, undefined, 'premises')).status, 403);
});
test('confirmation atomically reuses existing premises, creates missing premises and saves prices; retry creates nothing', async () => {
    const mock = fixture(), docs = await documents();
    const old = { ...mock.records.get('OUTLET/outlet/PREMISES/ac') };
    assert.deepEqual(await createProductImportChunk(mock.db, 'outlet', docs, context), { created: 1, existing: 0 });
    assert.deepEqual(mock.records.get('OUTLET/outlet/PREMISES/ac'), old);
    const premises = [...mock.records].filter(([path]) => path.startsWith('OUTLET/outlet/PREMISES/'));
    assert.equal(premises.length, 2);
    assert.equal(premises[1][1].name, 'Non AC Table');
    assert.equal(premises[1][1].code, 5);
    const count = mock.writes();
    assert.deepEqual(await createProductImportChunk(mock.db, 'outlet', docs, context), { created: 0, existing: 1 });
    assert.equal(mock.writes(), count);
});
test('concurrent retry creates each product and missing premises once', async () => {
    const mock = fixture(), docs = await documents();
    const results = await Promise.all([createProductImportChunk(mock.db, 'outlet', docs, context), createProductImportChunk(mock.db, 'outlet', docs, context)]);
    assert.equal(results.reduce((sum, result) => sum + result.created, 0), 1);
    assert.equal(mock.writes(), 2);
});
test('missing category, revoked authorization and inactive outlet prevent all product/premises writes', async () => {
    for (const path of ['OUTLET/outlet/CATEGORY/cat', 'USER_PROFILE/user', 'OUTLET/outlet']) {
        const mock = fixture();
        mock.records.delete(path);
        await assert.rejects(createProductImportChunk(mock.db, 'outlet', await documents(), context));
        assert.equal(mock.writes(), 0);
    }
});
test('ambiguous existing premises are rejected rather than selected arbitrarily', async () => {
    const mock = fixture();
    mock.records.set('OUTLET/outlet/PREMISES/duplicate', { name: 'AC Table' });
    await assert.rejects(createProductImportChunk(mock.db, 'outlet', await documents(), context), /Multiple premises/);
    assert.equal(mock.writes(), 0);
});
test('changed source price conflicts with the existing product instead of overwriting it', async () => {
    const mock = fixture(), docs = await documents();
    await createProductImportChunk(mock.db, 'outlet', docs, context);
    docs[0].fields.priceTable = JSON.stringify({ 'default price': 20, 'AC Table price': 99, 'Non AC Table price': 0 });
    await assert.rejects(createProductImportChunk(mock.db, 'outlet', docs, context), /differs/);
    assert.equal(mock.writes(), 2);
});
test('category resolution preserves named prices and reconciles retries through the complete import flow', async () => {
    const { persistProductImportWithCategories } = await import('../src/productImportFlow.js');
    const mock = fixture();
    mock.records.delete('OUTLET/outlet/CATEGORY/cat');
    const before = { ...deps, readCategories: async () => mock.records.has('OUTLET/outlet/CATEGORY/cat') ? [{ id: 'cat', name: 'Food', categoryNo: 1 }] : [], readProducts: async () => [...mock.records]
            .filter(([path]) => path.startsWith('OUTLET/outlet/PRODUCT/')).map(([path, fields]) => ({ id: path.split('/').at(-1), fields })) };
    const writer = { enabled: true, readExisting: before.readProducts,
        createChunk: (outlet, docs) => createProductImportChunk(mock.db, outlet, docs, context) };
    const resolve = async () => {
        mock.records.set('OUTLET/outlet/CATEGORY/cat', { name: 'Food', categoryNo: 1 });
        return { success: true, categories: [{ id: 'cat', name: 'Food', categoryNo: 1 }], created: 1, reused: 0, issues: [] };
    };
    const result = await persistProductImportWithCategories('outlet', 'user', source, [1], before, resolve, writer, 'premises');
    assert.equal(result.success, true);
    assert.equal(result.created, 1);
    const product = [...mock.records].find(([path]) => path.startsWith('OUTLET/outlet/PRODUCT/'))[1];
    assert.equal(product.category, 'cat');
    assert.equal(JSON.parse(String(product.priceTable))['AC Table price'], 25.5);
    assert.equal((await persistProductImportWithCategories('outlet', 'user', source, [1], before, resolve, writer, 'premises')).existing, 1);
});
//# sourceMappingURL=namedPremisesImport.test.js.map