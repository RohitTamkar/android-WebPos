import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { createOutletProduct, ProductCreationError, productTaxes, validateNewProduct } from '../src/productCreation.js';
import { nextProductCode } from '../src/productImportValidation.js';
import { createProductImportChunk } from '../src/productImportWriter.js';
import { allocateProductCodes } from '../src/productImportValidation.js';
class Ref {
    path;
    query;
    constructor(path, query = false) {
        this.path = path;
        this.query = query;
    }
    get id() { return this.path.split('/').at(-1); }
    doc(id) { return new Ref(`${this.path}/${id}`); }
    collection(name) { return new Ref(`${this.path}/${name}`, true); }
}
function fixture() {
    const records = new Map([
        ['USER_PROFILE/user', { active: true, outlets: ['outlet'] }],
        ['OUTLET/outlet/CATEGORY/cat', { name: 'Food' }],
        ['MASTERS/masters/TAX_MASTER/gst', { percent: 5, index: 7, type: 0 }],
    ]);
    const versions = new Map();
    const reads = [];
    let retries = 0;
    let failAfterCommit = false;
    const mock = {
        collection: (path) => new Ref(path, true),
        async runTransaction(callback) {
            for (;;) {
                const readVersions = new Map();
                const writes = [];
                const result = await callback({
                    get: async (ref) => {
                        assert.equal(writes.length, 0);
                        reads.push(ref.path);
                        readVersions.set(ref.path, versions.get(ref.path) ?? 0);
                        const snapshot = ref.query ? { docs: [...records].filter(([path]) => path.startsWith(`${ref.path}/`) && path.split('/').length === ref.path.split('/').length + 1)
                                .map(([path, fields]) => ({ id: path.split('/').at(-1), data: () => ({ ...fields }) })) }
                            : { exists: records.has(ref.path), data: () => records.get(ref.path) };
                        await Promise.resolve();
                        return snapshot;
                    },
                    create: (ref, fields) => writes.push([ref, fields]),
                });
                if ([...readVersions].some(([path, version]) => (versions.get(path) ?? 0) !== version)) {
                    retries++;
                    continue;
                }
                for (const [ref] of writes)
                    assert.equal(records.has(ref.path), false, 'never overwrite any record');
                for (const [ref, fields] of writes) {
                    records.set(ref.path, fields);
                    for (const path of [ref.path, ref.path.split('/').slice(0, -1).join('/')])
                        versions.set(path, (versions.get(path) ?? 0) + 1);
                }
                if (failAfterCommit && writes.length) {
                    failAfterCommit = false;
                    throw new Error('lost response');
                }
                return result;
            }
        },
    };
    return { db: mock, records, reads, retries: () => retries,
        loseResponse: () => { failAfterCommit = true; },
        products: () => [...records].filter(([path]) => path.startsWith('OUTLET/outlet/PRODUCT/')) };
}
const assigned = (profile) => profile.outlets;
const input = () => ({ requestId: randomUUID(), code: 1, name: 'New Product', price: 25.5, mrpPrice: 30,
    costPrice: 10, category: 'cat', regionalName: 'Local', discount: 5, shortName: 'NEW', taxIndex: 7,
    hsnCode: '1234', unitId: 2, weighable: false, stockable: false });
const taxes = [{ percent: 5, index: 7, type: 0 }];
test('required fields and invalid numerics, references and boolean inputs cannot save', () => {
    for (const changes of [{ name: '' }, { price: -1 }, { price: '20' }, { price: NaN }, { price: Infinity },
        { mrpPrice: -1 }, { costPrice: -1 }, { discount: 101 }, { discount: -1 }, { category: 'foreign' },
        { category: 'a/b' }, { taxIndex: 999 }, { unitId: 99 }, { stockable: 'yes' }, { requestId: 'bad' }]) {
        assert.throws(() => validateNewProduct({ ...input(), ...changes }, ['cat'], taxes), ProductCreationError);
    }
    assert.throws(() => validateNewProduct(input(), ['cat'], [...taxes, ...taxes]), /highlighted/);
    assert.deepEqual(productTaxes([{ type: 0, percent: 5, index: 7 }, { type: 1, percent: 5, index: 8 }, { type: 0, percent: '5', index: 9 }]), taxes);
});
test('creates only an existing-schema product with matching ID, zero stock and correct prices and options', async () => {
    for (const weighable of [true, false])
        for (const stockable of [true, false]) {
            const f = fixture();
            const before = structuredClone(f.records);
            const product = await createOutletProduct(f.db, 'outlet', 'user', assigned, { ...input(), weighable, stockable, unexpected: true });
            assert.equal(product.fields.id, product.documentId);
            assert.match(product.documentId, /^[a-f0-9]{20}$/);
            assert.equal(product.fields.priceTable, '{"default price":25.5}');
            assert.equal(product.fields.currentStock, 0);
            assert.equal(product.fields.reorderLevel, 0);
            assert.equal(product.fields.unitId, 2);
            assert.equal(product.fields.taxIndex, 7);
            assert.equal(product.fields.category, 'cat');
            assert.equal(product.fields.discount, 5);
            assert.equal(product.fields.weighable, weighable);
            assert.equal(product.fields.stockable, stockable);
            assert.equal(product.fields.barcode, '0');
            assert.equal(product.fields.active, false);
            assert.equal(product.fields.onlineSynced, false);
            assert.equal(product.fields.unexpected, undefined);
            for (const [path, fields] of before)
                assert.deepEqual(f.records.get(path), fields);
            assert.equal(f.records.size, before.size + 1);
        }
});
test('gaps, numeric strings and invalid legacy values use highest plus one; stale code rejects without write', async () => {
    const f = fixture();
    for (const [i, code] of [1, '050', 7, 'bad', null].entries())
        f.records.set(`OUTLET/outlet/PRODUCT/old${i}`, { name: `Old ${i}`, code });
    const before = structuredClone(f.records);
    const draft = input();
    await assert.rejects(createOutletProduct(f.db, 'outlet', 'user', assigned, draft), error => {
        assert.ok(error instanceof ProductCreationError);
        assert.equal(error.status, 409);
        assert.equal(error.nextCode, 51);
        return true;
    });
    assert.deepEqual(f.records, before);
    const result = await createOutletProduct(f.db, 'outlet', 'user', assigned, { ...draft, code: 51 });
    assert.equal(result.fields.code, 51);
    assert.equal(nextProductCode(f.products().map(([id, fields]) => ({ id, fields }))), 52);
});
test('authorization rejects missing sessions, inactive users and other outlets before product reads', async () => {
    const f = fixture();
    for (const [outlet, user, status] of [['outlet', null, 401], ['other', 'user', 403], ['bad/path', 'user', 400]]) {
        await assert.rejects(createOutletProduct(f.db, outlet, user, assigned, input()), error => error instanceof ProductCreationError && error.status === status);
    }
    f.records.set('USER_PROFILE/user', { active: false, outlets: ['outlet'] });
    await assert.rejects(createOutletProduct(f.db, 'outlet', 'user', assigned, input()), error => error instanceof ProductCreationError && error.status === 403);
    assert.ok(f.reads.every(path => path === 'USER_PROFILE/user'));
});
test('failed transactions, lost responses and repeated requests create no duplicate products', async () => {
    const f = fixture();
    const draft = input();
    f.loseResponse();
    await assert.rejects(createOutletProduct(f.db, 'outlet', 'user', assigned, draft), /lost response/);
    assert.equal(f.products().length, 1);
    const a = await createOutletProduct(f.db, 'outlet', 'user', assigned, draft);
    const b = await createOutletProduct(f.db, 'outlet', 'user', assigned, draft);
    assert.equal(a.documentId, b.documentId);
    assert.equal(f.products().length, 1);
    await assert.rejects(createOutletProduct(f.db, 'outlet', 'user', assigned, { ...draft, price: 99 }), /differs/);
    await assert.rejects(createOutletProduct(f.db, 'outlet', 'user', assigned, { ...draft, requestId: randomUUID(), code: 2 }), /already matches/);
    assert.equal(f.products().length, 1);
});
test('concurrent form saves cannot allocate duplicate codes; losing form can review and retry', async () => {
    const f = fixture();
    const drafts = [input(), { ...input(), name: 'Other' }];
    const results = await Promise.allSettled(drafts.map(draft => createOutletProduct(f.db, 'outlet', 'user', assigned, draft)));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(f.products().length, 1);
    assert.equal(f.retries(), 1);
    const loser = results.findIndex(result => result.status === 'rejected');
    await createOutletProduct(f.db, 'outlet', 'user', assigned, { ...drafts[loser], code: 2 });
    assert.deepEqual(f.products().map(([, fields]) => fields.code), [1, 2]);
});
test('manual creation and Excel upload contend on the same allocation query', async () => {
    const f = fixture();
    const planned = allocateProductCodes('outlet', [{ rowNumber: 2, sourceIdentity: 'excel-row', fields: { name: 'Excel Product', code: 1 } }], []);
    const results = await Promise.allSettled([
        createOutletProduct(f.db, 'outlet', 'user', assigned, input()),
        createProductImportChunk(f.db, 'outlet', planned),
    ]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(f.products().length, 1);
    assert.equal(f.products()[0]?.[1].code, 1);
});
test('other outlet codes do not influence allocation or modify foreign records', async () => {
    const f = fixture();
    f.records.set('OUTLET/foreign/PRODUCT/old', { name: 'Foreign', code: 999 });
    const result = await createOutletProduct(f.db, 'outlet', 'user', assigned, input());
    assert.equal(result.fields.code, 1);
    assert.deepEqual(f.records.get('OUTLET/foreign/PRODUCT/old'), { name: 'Foreign', code: 999 });
});
test('manual Add Product matches the supplied Firestore document contract exactly and continues 196 to 197', async () => {
    const f = fixture();
    const category = 'hNGSFIOeAC7hRIzkjbUA';
    f.records.set(`OUTLET/outlet/CATEGORY/${category}`, { name: 'Dosa' });
    f.records.set('OUTLET/outlet/PRODUCT/old', { name: 'Existing product', code: 196, barcode: '0' });
    f.records.set('MASTERS/masters/TAX_MASTER/gst', { percent: 0, index: 1, type: 0 });
    const before = structuredClone(f.records);
    const saved = await createOutletProduct(f.db, 'outlet', 'user', assigned, {
        ...input(), code: 197, name: 'DOSA', price: 50, mrpPrice: 0, costPrice: 0,
        regionalName: 'DOSA', discount: 0, shortName: '', hsnCode: '', taxIndex: 1, category,
        active: true, currentStock: 999, arbitraryField: 'must not be saved',
    });
    assert.ok(saved.fields.dateTme instanceof Timestamp);
    assert.deepEqual(saved.fields, {
        active: false, barcode: '0', category, cess: 0, code: 197, costPrice: 0,
        currentStock: 0, dateTme: saved.fields.dateTme, discount: 0, hsnCode: '', id: saved.documentId,
        keyCount: 0, kitchenId: '', mrpPrice: 0, name: 'DOSA', onlinePrice: 0, onlineSynced: false,
        price: 50, priceTable: '{"default price":50}', recipeId: '', regionalName: 'DOSA',
        reorderLevel: 0, selected: false, shortName: '', stockable: false, taxIndex: 1, type: 0,
        unitId: 2, weighable: false, wholeSaleAmount: 0,
    });
    assert.deepEqual(f.records.get(`OUTLET/outlet/PRODUCT/${saved.documentId}`), saved.fields);
    assert.equal(f.records.size, before.size + 1);
    for (const [path, fields] of before)
        assert.deepEqual(f.records.get(path), fields);
});
//# sourceMappingURL=productCreation.test.js.map