import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProductImportChunk } from '../src/productImportWriter.js';
import { allocateProductCodes } from '../src/productImportValidation.js';
// Isolated optimistic transaction harness: query versions include phantom inserts.
// Concurrent transactions start from the same snapshot; the loser reruns its callback.
function isolatedFirestore() {
    const outlets = new Map();
    const versions = new Map();
    let retries = 0;
    const db = {
        collection(name) {
            assert.equal(name, 'OUTLET');
            return { doc: (outlet) => ({ collection: (name) => {
                        assert.equal(name, 'PRODUCT');
                        return { outlet, doc: id => ({ outlet, id }) };
                    } }) };
        },
        async runTransaction(callback) {
            for (;;) {
                let readOutlet = '', version = 0;
                const writes = [];
                const result = await callback({
                    get: async (query) => {
                        assert.equal(writes.length, 0, 'all reads must precede writes');
                        readOutlet = query.outlet;
                        version = versions.get(readOutlet) ?? 0;
                        const docs = [...(outlets.get(readOutlet) ?? [])].map(([id, fields]) => ({ id, data: () => ({ ...fields }) }));
                        await Promise.resolve();
                        return { docs };
                    },
                    create: (ref, fields) => { writes.push({ ref, fields }); },
                });
                if ((versions.get(readOutlet) ?? 0) !== version) {
                    retries++;
                    continue;
                }
                const store = outlets.get(readOutlet) ?? new Map();
                for (const { ref } of writes)
                    assert.equal(store.has(ref.id), false, 'create must never overwrite');
                for (const { ref, fields } of writes)
                    store.set(ref.id, fields);
                outlets.set(readOutlet, store);
                if (writes.length)
                    versions.set(readOutlet, version + 1);
                return result;
            }
        },
    };
    return { db: db, outlets, retries: () => retries };
}
const document = (name) => ({ rowNumber: 2, sourceIdentity: name, fields: { name, code: 1, barcode: '0001' } });
test('concurrent empty-outlet imports retry the query; stale preview cannot commit duplicate code', async () => {
    const mock = isolatedFirestore();
    const a = allocateProductCodes('outlet', [document('A')], []);
    const b = allocateProductCodes('outlet', [document('B')], []);
    const results = await Promise.allSettled([
        createProductImportChunk(mock.db, 'outlet', a), createProductImportChunk(mock.db, 'outlet', b),
    ]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.match(String(results.find(r => r.status === 'rejected').reason), /changed since preview/);
    assert.equal(mock.retries(), 1);
    const saved = [...mock.outlets.get('outlet')].map(([id, fields]) => ({ id, fields }));
    assert.equal(saved.length, 1);
    const loser = results[0].status === 'rejected' ? a : b;
    const fresh = allocateProductCodes('outlet', loser, saved);
    assert.equal(fresh[0]?.fields.code, 2);
    await createProductImportChunk(mock.db, 'outlet', fresh);
    assert.deepEqual([...mock.outlets.get('outlet').values()].map(p => p.code), [1, 2]);
});
test('concurrent retry of the same upload creates each product once', async () => {
    const mock = isolatedFirestore();
    const planned = allocateProductCodes('outlet', [document('A')], []);
    const results = await Promise.all([
        createProductImportChunk(mock.db, 'outlet', planned), createProductImportChunk(mock.db, 'outlet', planned),
    ]);
    assert.equal(results.reduce((sum, result) => sum + result.created, 0), 1);
    assert.equal(results.reduce((sum, result) => sum + result.existing, 0), 1);
    assert.equal(mock.outlets.get('outlet').size, 1);
});
test('concurrent outlets allocate independently using only their own PRODUCT query', async () => {
    const mock = isolatedFirestore();
    mock.outlets.set('first', new Map([['old', { name: 'Old', code: '50' }]]));
    const existing = [{ id: 'old', fields: { name: 'Old', code: '50' } }];
    await Promise.all([
        createProductImportChunk(mock.db, 'first', allocateProductCodes('first', [document('A')], existing)),
        createProductImportChunk(mock.db, 'second', allocateProductCodes('second', [document('A')], [])),
    ]);
    assert.equal([...mock.outlets.get('first').values()][1]?.code, 51);
    assert.equal([...mock.outlets.get('second').values()][0]?.code, 1);
    assert.deepEqual(mock.outlets.get('first').get('old'), { name: 'Old', code: '50' });
});
//# sourceMappingURL=productImportWriter.test.js.map