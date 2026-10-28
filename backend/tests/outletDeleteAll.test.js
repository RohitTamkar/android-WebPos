import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deleteAllOutletRecords, OutletDeletionError } from '../src/outletDeletion.js';
class Ref {
    path;
    records;
    constructor(path, records) {
        this.path = path;
        this.records = records;
    }
    doc(id) { return new Ref(`${this.path}/${id}`, this.records); }
    collection(name) { return new Ref(`${this.path}/${name}`, this.records); }
    async get() { return { data: () => this.records.get(this.path) }; }
    select() {
        return { get: async () => ({ docs: [...this.records.keys()]
                    .filter(path => path.startsWith(`${this.path}/`) && path.split('/').length === this.path.split('/').length + 1)
                    .map(path => ({ ref: new Ref(path, this.records) })) }) };
    }
}
function fixture(products = 3) {
    const records = new Map([
        ['USER_PROFILE/user', { active: true, outlets: ['outlet'] }],
        ['OUTLET/outlet/CATEGORY/c1', { name: 'Food' }], ['OUTLET/outlet/CATEGORY/c2', { name: 'Drinks' }],
        ['OUTLET/foreign/PRODUCT/p1', { name: 'Foreign' }], ['OUTLET/foreign/CATEGORY/c1', { name: 'Foreign' }],
        ['OUTLET/outlet/BILL/b1', { product: 'p0' }], ['OUTLET/outlet', { name: 'Outlet' }],
    ]);
    for (let index = 0; index < products; index++)
        records.set(`OUTLET/outlet/PRODUCT/p${index}`, { name: `P${index}`, category: 'c1' });
    const commits = [];
    let failOnCommit = -1;
    const db = {
        collection: (name) => new Ref(name, records),
        batch() {
            const pending = [];
            return { delete: (ref) => { pending.push(ref.path); },
                commit: async () => {
                    if (commits.length === failOnCommit) {
                        failOnCommit = -1;
                        throw new Error('database failure');
                    }
                    pending.forEach(path => records.delete(path));
                    commits.push(pending.length);
                } };
        },
    };
    return { db: db, records, commits, failNextCommit: (index) => { failOnCommit = index; } };
}
const assigned = (profile) => profile.outlets;
const keys = (records) => [...records.keys()].sort();
test('delete all products also deletes every category in the same outlet', async () => {
    const f = fixture();
    const result = await deleteAllOutletRecords(f.db, 'outlet', 'PRODUCT', 'user', assigned, { confirm: 'DELETE_ALL_PRODUCTS' });
    assert.deepEqual(result, { deleted: 3, deletedCategories: 2 });
    assert.deepEqual(keys(f.records), ['OUTLET/foreign/CATEGORY/c1', 'OUTLET/foreign/PRODUCT/p1', 'OUTLET/outlet', 'OUTLET/outlet/BILL/b1',
        'USER_PROFILE/user']);
});
test('delete all categories keeps every product and its fields unchanged', async () => {
    const f = fixture();
    const products = [...f.records].filter(([path]) => path.startsWith('OUTLET/outlet/PRODUCT/'));
    assert.deepEqual(await deleteAllOutletRecords(f.db, 'outlet', 'CATEGORY', 'user', assigned, { confirm: 'DELETE_ALL_CATEGORIES' }), { deleted: 2 });
    assert.ok(![...f.records.keys()].some(path => path.startsWith('OUTLET/outlet/CATEGORY/')));
    for (const [path, fields] of products)
        assert.deepEqual(f.records.get(path), fields);
    assert.ok(f.records.has('OUTLET/foreign/CATEGORY/c1'));
});
test('large collections commit in batches; a failed batch reports progress and a retry finishes', async () => {
    const f = fixture(950);
    f.failNextCommit(1);
    await assert.rejects(deleteAllOutletRecords(f.db, 'outlet', 'PRODUCT', 'user', assigned, { confirm: 'DELETE_ALL_PRODUCTS' }), error => error instanceof OutletDeletionError && error.status === 503 && error.message.startsWith('400 of 950 deleted'));
    assert.ok(f.records.has('OUTLET/outlet/CATEGORY/c1'), 'Failed product deletion must leave categories intact');
    assert.deepEqual(await deleteAllOutletRecords(f.db, 'outlet', 'PRODUCT', 'user', assigned, { confirm: 'DELETE_ALL_PRODUCTS' }), { deleted: 550, deletedCategories: 2 });
    assert.deepEqual(f.commits, [400, 400, 150, 2]);
    assert.deepEqual(await deleteAllOutletRecords(f.db, 'outlet', 'PRODUCT', 'user', assigned, { confirm: 'DELETE_ALL_PRODUCTS' }), { deleted: 0, deletedCategories: 0 });
});
test('missing or mismatched confirmation, bad sessions, outlets and inactive users delete nothing', async () => {
    const f = fixture();
    const before = keys(f.records);
    const cases = [
        ['outlet', 'PRODUCT', 'user', {}, 400], ['outlet', 'PRODUCT', 'user', { confirm: 'DELETE_ALL_CATEGORIES' }, 400],
        ['outlet', 'CATEGORY', 'user', null, 400], ['outlet', 'PRODUCT', null, { confirm: 'DELETE_ALL_PRODUCTS' }, 401],
        ['foreign', 'PRODUCT', 'user', { confirm: 'DELETE_ALL_PRODUCTS' }, 403], ['outlet', 'PRODUCT', 'missing', { confirm: 'DELETE_ALL_PRODUCTS' }, 403],
        ['a/b', 'PRODUCT', 'user', { confirm: 'DELETE_ALL_PRODUCTS' }, 400],
    ];
    for (const [outlet, collection, user, body, status] of cases) {
        await assert.rejects(deleteAllOutletRecords(f.db, outlet, collection, user, assigned, body), error => error instanceof OutletDeletionError && error.status === status);
    }
    f.records.set('USER_PROFILE/user', { active: false, outlets: ['outlet'] });
    await assert.rejects(deleteAllOutletRecords(f.db, 'outlet', 'PRODUCT', 'user', assigned, { confirm: 'DELETE_ALL_PRODUCTS' }), error => error instanceof OutletDeletionError && error.status === 403);
    assert.deepEqual(keys(f.records), before);
    assert.deepEqual(f.commits, []);
});
test('a failed category cleanup after deleting products can be retried safely', async () => {
    const f = fixture();
    f.failNextCommit(1);
    await assert.rejects(deleteAllOutletRecords(f.db, 'outlet', 'PRODUCT', 'user', assigned, { confirm: 'DELETE_ALL_PRODUCTS' }), { status: 503 });
    assert.ok(!keys(f.records).some(path => path.startsWith('OUTLET/outlet/PRODUCT/')));
    assert.ok(f.records.has('OUTLET/outlet/CATEGORY/c1'));
    assert.deepEqual(await deleteAllOutletRecords(f.db, 'outlet', 'PRODUCT', 'user', assigned, { confirm: 'DELETE_ALL_PRODUCTS' }), { deleted: 0, deletedCategories: 2 });
    assert.ok(f.records.has('OUTLET/outlet/BILL/b1') && f.records.has('OUTLET/foreign/CATEGORY/c1'));
});
//# sourceMappingURL=outletDeleteAll.test.js.map