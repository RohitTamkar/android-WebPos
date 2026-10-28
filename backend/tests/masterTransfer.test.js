import assert from 'node:assert/strict';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import { issueTransferAuthorization, requireTransferAuthorization, transferOutletMasters, transferOutletMastersWithStorage } from '../src/masterTransfer.js';
const secret = 'isolated-master-transfer-test-key';
const requiredFields = ['name', 'category', 'taxIndex', 'unitId'];
const assignment = (profile) => Array.isArray(profile.outlets) ? profile.outlets : [];
function fixture() {
    const records = new Map([
        ['USER_PROFILE/user', { active: true, outlets: ['source', 'destination'] }],
        ['OUTLET/source', { name: 'Source' }], ['OUTLET/destination', { name: 'Destination' }],
        ['OUTLET/source/CATEGORY/c1', { categoryNo: 1, name: 'Coffee', regionalName: 'Regional', dayType: 'All', privateSetting: 'Never copy' }],
        ['OUTLET/source/CATEGORY/c2', { categoryNo: 2, name: 'Food', regionalName: '' }],
        ['OUTLET/destination/CATEGORY/d1', { categoryNo: 9, name: 'Existing category', id: 'd1' }],
        ['OUTLET/source/PRODUCT/p1', { id: 'source-product', code: 55, name: 'Coffee product', regionalName: 'Regional product', shortName: 'CP',
                category: 'c1', price: 45, priceTable: '{"default price":45,"other price":99}', mrpPrice: 60, costPrice: 20, taxIndex: 1, unitId: 2,
                hsnCode: '123', barcode: 'BAR-1', discount: 25, stockable: true, weighable: true, currentStock: 999, purchaseHistory: 'Never copy', privateValue: 'Never copy' }],
        ['OUTLET/destination/PRODUCT/old', { id: 'old', code: 20, name: 'Other product', barcode: 'OTHER', currentStock: 77, discount: 7, stockable: true, weighable: false }],
        ['MASTERS/masters/TAX_MASTER/tax', { type: 0, index: 1, percent: 5 }],
    ]);
    const reads = [], writes = [];
    let failCommit = false, retry = false;
    const ref = (path, kind) => ({ path, kind, id: path.split('/').at(-1),
        doc: (id) => ref(`${path}/${id}`, 'doc'), collection: (id) => ref(`${path}/${id}`, 'collection') });
    const snapshot = (path) => ({ id: path.split('/').at(-1), exists: records.has(path), data: () => structuredClone(records.get(path)) });
    let queue = Promise.resolve();
    const db = { collection: (name) => ref(name, 'collection'), runTransaction: (callback) => {
            const operation = queue.then(async () => {
                let pending = [];
                const transaction = {
                    get: async (reference) => {
                        assert.equal(pending.length, 0, 'All reads precede transaction writes');
                        reads.push(reference.path);
                        return reference.kind === 'doc' ? snapshot(reference.path) : { docs: [...records.keys()]
                                .filter(path => path.startsWith(reference.path + '/') && !path.slice(reference.path.length + 1).includes('/')).map(snapshot) };
                    },
                    create: (reference, data) => { pending.push({ path: reference.path, data }); },
                };
                let result = await callback(transaction);
                if (retry) {
                    retry = false;
                    pending = [];
                    records.set('OUTLET/destination/CATEGORY/concurrent', { name: 'Concurrent category', categoryNo: 100 });
                    records.set('OUTLET/destination/PRODUCT/concurrent', { name: 'Concurrent unrelated product', code: 100, currentStock: 12 });
                    result = await callback(transaction);
                }
                if (failCommit)
                    throw new Error('SIMULATED COMMIT FAILURE');
                for (const write of pending)
                    assert.ok(!records.has(write.path), 'No overwrite is permitted');
                for (const write of pending) {
                    writes.push(write.path);
                    records.set(write.path, structuredClone(write.data));
                }
                return result;
            });
            queue = operation.then(() => undefined, () => undefined);
            return operation;
        } };
    const grant = issueTransferAuthorization(secret, 'user', 'source', 'destination');
    const productRequest = { destinationOutletId: 'destination', mode: 'products', categoryIds: [],
        products: [{ sourceProductId: 'p1', fields: [...requiredFields] }], categoryMappings: { c1: 'd1' } };
    const categories = { destinationOutletId: 'destination', mode: 'categories', categoryIds: ['c1', 'c2'], products: [], categoryMappings: {} };
    return { records, reads, writes, db, grant, productRequest, categories,
        transfer: (raw, authorization = grant, user = 'user') => transferOutletMasters(db, 'source', user, assignment, secret, authorization, raw),
        fail: () => { failCommit = true; }, retry: () => { retry = true; } };
}
function fakeStorage(seed = {}) {
    const objects = new Map(Object.entries(seed));
    const bucket = { file: (path) => ({
            save: async (bytes, options) => {
                if (options?.preconditionOpts?.ifGenerationMatch === 0 && objects.has(path))
                    throw { code: 412 };
                objects.set(path, Buffer.from(bytes));
            },
            getMetadata: async () => { const bytes = objects.get(path); if (!bytes)
                throw new Error('missing'); return [{ size: String(bytes.length), contentType: 'image/png' }]; },
            getSignedUrl: async () => { const bytes = objects.get(path); if (!bytes)
                throw new Error('missing'); return [`data:application/octet-stream;base64,${bytes.toString('base64')}`]; },
        }) };
    return { bucket, objects };
}
const newProducts = (f) => f.writes.filter(path => path.includes('/PRODUCT/')).map(path => f.records.get(path));
test('writes only selected category masters with new destination IDs and preserves source data', async () => {
    const f = fixture();
    const before = structuredClone(f.records);
    const result = await f.transfer({ ...f.categories, categoryIds: ['c1'] });
    assert.equal(result.created, 1);
    assert.equal(f.writes.length, 1);
    const saved = f.records.get(f.writes[0]);
    assert.deepEqual(Object.keys(saved).sort(), ['categoryNo', 'dayType', 'id', 'name', 'onlineSynced', 'regionalName', 'selected'].sort());
    assert.notEqual(saved.id, 'c1');
    assert.equal(saved.name, 'Coffee');
    for (const [path, data] of before)
        assert.deepEqual(f.records.get(path), data);
});
test('new products copy only explicitly selected fields, allocate destination codes, and always start with zero stock', async () => {
    const f = fixture();
    const before = structuredClone(f.records);
    const result = await f.transfer(f.productRequest);
    const product = newProducts(f)[0];
    assert.equal(result.created, 1);
    assert.equal(product.code, 21);
    assert.equal(product.category, 'd1');
    assert.equal(product.currentStock, 0);
    assert.equal(product.discount, 0);
    assert.equal(product.price, 0);
    assert.equal(product.stockable, false);
    assert.equal(product.weighable, false);
    assert.equal(product.barcode, '');
    assert.equal(product.regionalName, '');
    assert.ok(!('purchaseHistory' in product));
    assert.ok(!('privateValue' in product));
    assert.ok(f.writes.every(path => path.startsWith('OUTLET/destination/PRODUCT/')));
    for (const [path, data] of before)
        assert.deepEqual(f.records.get(path), data);
});
test('supports independent configuration flags, explicit discount and barcode, and default-price-only serialization', async () => {
    for (const selected of [['stockable'], ['weighable'], ['stockable', 'weighable', 'discount', 'barcode', 'price', 'hsnCode']]) {
        const f = fixture();
        f.productRequest.products[0].fields.push(...selected);
        await f.transfer(f.productRequest);
        const product = newProducts(f)[0];
        assert.equal(product.stockable, selected.includes('stockable'));
        assert.equal(product.weighable, selected.includes('weighable'));
        assert.equal(product.currentStock, 0);
        assert.equal(product.discount, selected.includes('discount') ? 25 : 0);
        if (selected.includes('price'))
            assert.deepEqual(JSON.parse(String(product.priceTable)), { 'default price': 45 });
        if (selected.includes('barcode'))
            assert.equal(product.barcode, 'BAR-1');
    }
});
test('transfers required categories and maps products to the newly created destination IDs', async () => {
    const f = fixture();
    f.productRequest.categoryIds = ['c1'];
    f.productRequest.categoryMappings = {};
    const result = await f.transfer(f.productRequest);
    assert.equal(result.created, 2);
    const category = result.items.find(item => item.type === 'category');
    assert.equal(newProducts(f)[0].category, category.destinationId);
    assert.notEqual(category.destinationId, 'c1');
});
test('product image is copied and verified before its destination document is created', async () => {
    const f = fixture();
    const sourcePath = 'sensible_images/OUTLET/source/PRODUCT_IMAGES/p1/abc123.png';
    f.records.get('OUTLET/source/PRODUCT/p1').imagePath = sourcePath;
    const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]);
    const { bucket, objects } = fakeStorage({ [sourcePath]: bytes });
    const result = await transferOutletMastersWithStorage(f.db, 'source', 'user', assignment, secret, f.grant, f.productRequest, bucket);
    const product = newProducts(f)[0];
    assert.equal(result.created, 1);
    assert.equal(typeof product.image, 'string');
    assert.equal(product.imagePath, undefined);
    assert.equal(objects.get(`product_images/${String(product.image)}`)?.equals(bytes), true);
});
test('migrated image paths transfer into image, retry safely, and retain existing legacy destination records', async () => {
    const f = fixture();
    const path = 'sensible_images/OUTLET/source/PRODUCT_IMAGES/p1/abc123.png';
    Object.assign(f.records.get('OUTLET/source/PRODUCT/p1'), { image: path, imagePath: 'stale/legacy/path' });
    const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]);
    const { bucket, objects } = fakeStorage({ [path]: bytes });
    const transfer = () => transferOutletMastersWithStorage(f.db, 'source', 'user', assignment, secret, f.grant, f.productRequest, bucket);
    assert.equal((await transfer()).created, 1);
    const product = newProducts(f)[0];
    assert.equal(product.imagePath, undefined);
    assert.match(String(product.image), /^[a-f0-9]{64}\.png$/);
    assert.deepEqual(objects.get(`product_images/${String(product.image)}`), bytes);
    assert.equal((await transfer()).unchanged, 1);
    product.imagePath = `sensible_images/OUTLET/destination/PRODUCT_IMAGES/${String(product.id)}/abc123.png`;
    objects.set(String(product.imagePath), bytes);
    delete product.image;
    const legacy = structuredClone(product);
    assert.equal((await transfer()).unchanged, 1);
    assert.deepEqual(product, legacy);
    assert.equal(f.writes.length, 1);
    assert.equal(objects.size, 3);
});
test('image-only products retain their verified existing filename without duplicate uploads and with safe retries', async () => {
    const f = fixture();
    const source = f.records.get('OUTLET/source/PRODUCT/p1');
    source.image = '1000014014.png';
    const before = structuredClone(f.records);
    const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]);
    const { bucket, objects } = fakeStorage({ 'product_images/1000014014.png': bytes });
    const transfer = () => transferOutletMastersWithStorage(f.db, 'source', 'user', assignment, secret, f.grant, f.productRequest, bucket);
    assert.equal((await transfer()).created, 1);
    const product = newProducts(f)[0];
    assert.equal(product.image, source.image);
    assert.equal(product.imagePath, undefined);
    assert.deepEqual(objects.get(`product_images/${String(product.image)}`), bytes);
    assert.equal(product.currentStock, 0);
    assert.equal(product.category, 'd1');
    for (const [path, data] of before)
        assert.deepEqual(f.records.get(path), data);
    assert.equal((await transfer()).unchanged, 1);
    assert.equal(f.writes.length, 1);
    assert.equal(objects.size, 1);
    product.image = 'different.png';
    assert.equal((await transfer()).skipped, 1, 'A retry never reports incompatible references as verified');
    assert.equal(product.image, 'different.png', 'Existing destination records are not rewritten');
});
test('unsupported, missing or mismatching product images skip creation without broken references', async () => {
    for (const mode of ['unsupported', 'missing', 'foreign-path', 'copy-failure', 'verification-failure', 'shared-verification-failure']) {
        const f = fixture();
        const source = f.records.get('OUTLET/source/PRODUCT/p1');
        const path = 'sensible_images/OUTLET/source/PRODUCT_IMAGES/p1/abc123.png';
        source.image = mode === 'unsupported' ? 'https://example.com/a.png' : '1000014014.png';
        if (mode === 'foreign-path')
            source.image = 'sensible_images/OUTLET/other/PRODUCT_IMAGES/p1/abc123.png';
        if (mode === 'copy-failure' || mode === 'verification-failure')
            source.image = path;
        const before = structuredClone(f.records);
        const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]);
        const { bucket, objects } = fakeStorage(mode === 'missing' ? {} : {
            'product_images/1000014014.png': bytes, [path]: bytes,
        });
        if (mode === 'copy-failure' || mode === 'verification-failure') {
            const file = bucket.file;
            bucket.file = (objectPath) => ({ ...file(objectPath),
                ...(objectPath.startsWith('product_images/') && objectPath !== 'product_images/1000014014.png'
                    ? mode === 'copy-failure' ? { save: async () => { throw new Error('failed'); } }
                        : { getMetadata: async () => [{ contentType: 'image/png', size: 999 }] } : {}) });
        }
        if (mode === 'shared-verification-failure') {
            const file = bucket.file;
            bucket.file = (objectPath) => ({ ...file(objectPath), getMetadata: async () => [{ contentType: 'image/png', size: 999 }] });
        }
        const result = await transferOutletMastersWithStorage(f.db, 'source', 'user', assignment, secret, f.grant, f.productRequest, bucket);
        assert.equal(result.created, 0, mode);
        assert.equal(result.skipped, 1, mode);
        assert.deepEqual(f.writes, []);
        assert.deepEqual(f.records, before);
        if (mode !== 'missing')
            assert.deepEqual(objects.get('product_images/1000014014.png'), bytes);
    }
});
test('active filename references transfer without recreating legacy imagePath', async () => {
    const f = fixture();
    const path = 'sensible_images/OUTLET/source/PRODUCT_IMAGES/p1/abc123.png';
    Object.assign(f.records.get('OUTLET/source/PRODUCT/p1'), { image: '1000014014.png', imagePath: path });
    const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]);
    const { bucket, objects } = fakeStorage({ 'product_images/1000014014.png': bytes, [path]: bytes });
    const result = await transferOutletMastersWithStorage(f.db, 'source', 'user', assignment, secret, f.grant, f.productRequest, bucket);
    assert.equal(result.created, 1);
    assert.equal(newProducts(f)[0].image, '1000014014.png');
    assert.equal(newProducts(f)[0].imagePath, undefined);
    assert.deepEqual(objects.get('product_images/1000014014.png'), bytes);
});
test('category and linked product images transfer to their matching destination records', async () => {
    const f = fixture();
    f.productRequest.categoryIds = ['c1'];
    f.productRequest.categoryMappings = {};
    const categoryPath = 'sensible_images/OUTLET/source/CATEGORY_IMAGES/c1/abc123.png';
    const productPath = 'sensible_images/OUTLET/source/PRODUCT_IMAGES/p1/def456.png';
    f.records.get('OUTLET/source/CATEGORY/c1').imagePath = categoryPath;
    f.records.get('OUTLET/source/PRODUCT/p1').imagePath = productPath;
    const categoryBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 2]);
    const productBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 3]);
    const { bucket, objects } = fakeStorage({ [categoryPath]: categoryBytes, [productPath]: productBytes });
    const result = await transferOutletMastersWithStorage(f.db, 'source', 'user', assignment, secret, f.grant, f.productRequest, bucket);
    const category = result.items.find(item => item.type === 'category');
    const product = newProducts(f)[0];
    assert.equal(result.created, 2);
    assert.equal(product.category, category.destinationId);
    assert.equal(objects.get(String(f.records.get(`OUTLET/destination/CATEGORY/${category.destinationId}`).imagePath))?.equals(categoryBytes), true);
    assert.equal(objects.get(`product_images/${String(product.image)}`)?.equals(productBytes), true);
});
test('explicit category mapping reuses an existing category without modifying it', async () => {
    const f = fixture();
    const before = structuredClone(f.records);
    const result = await f.transfer({ ...f.categories, categoryIds: ['c1'], categoryMappings: { c1: 'd1' } });
    assert.equal(result.items[0].status, 'mapped');
    assert.deepEqual(f.records, before);
    assert.deepEqual(f.writes, []);
});
test('a same-named destination category is already present; products go into it without changing it', async () => {
    const f = fixture();
    f.records.set('OUTLET/destination/CATEGORY/conflict', { name: ' coffee ', categoryNo: 100 });
    const category = structuredClone(f.records.get('OUTLET/destination/CATEGORY/conflict'));
    f.productRequest.categoryIds = ['c1'];
    f.productRequest.categoryMappings = {};
    const result = await f.transfer(f.productRequest);
    assert.equal(result.items[0].status, 'already-transferred');
    assert.equal(result.items[0].reason, 'Category already present in the destination.');
    assert.equal(result.unchanged, 1);
    assert.equal(result.created, 1);
    assert.equal(newProducts(f)[0].category, 'conflict');
    assert.deepEqual(f.records.get('OUTLET/destination/CATEGORY/conflict'), category);
    assert.ok(!f.writes.some(path => path.includes('/CATEGORY/')));
    const ambiguous = fixture();
    ambiguous.records.set('OUTLET/destination/CATEGORY/x', { name: 'Coffee' });
    ambiguous.records.set('OUTLET/destination/CATEGORY/y', { name: 'Coffee' });
    ambiguous.productRequest.categoryIds = ['c1'];
    ambiguous.productRequest.categoryMappings = {};
    const before = structuredClone(ambiguous.records);
    const unclear = await ambiguous.transfer(ambiguous.productRequest);
    assert.equal(unclear.skipped, 2);
    assert.deepEqual(ambiguous.records, before);
});
test('a destination product with the same name or barcode is already present and is never overwritten', async () => {
    for (const change of [{ name: 'Coffee product' }, { barcode: 'BAR-1' }]) {
        const f = fixture();
        Object.assign(f.records.get('OUTLET/destination/PRODUCT/old'), change);
        const before = structuredClone(f.records);
        const result = await f.transfer(f.productRequest);
        assert.equal(result.skipped, 0);
        assert.equal(result.unchanged, 1);
        assert.equal(result.items[0].status, 'already-transferred');
        assert.equal(result.items[0].reason, 'Product already present in the destination.');
        assert.deepEqual(f.records, before);
        assert.equal(f.records.get('OUTLET/destination/PRODUCT/old').currentStock, 77);
    }
});
test('repeated requests and concurrent retries do not duplicate categories or products', async () => {
    const f = fixture();
    f.productRequest.categoryIds = ['c1'];
    f.productRequest.categoryMappings = {};
    const [first, second] = await Promise.allSettled([f.transfer(f.productRequest), f.transfer(f.productRequest)]);
    assert.equal(first.status, 'fulfilled');
    assert.equal(first.value.created, 2);
    assert.equal(second.status, 'rejected');
    assert.equal(second.reason.status, 409);
    const retry = await f.transfer(f.productRequest);
    assert.equal(retry.created, 0);
    assert.equal(retry.unchanged, 2);
    assert.equal(f.writes.length, 2);
    const productPath = f.writes.find(path => path.includes('/PRODUCT/'));
    f.records.get(productPath).currentStock = 88;
    const third = await f.transfer(f.productRequest);
    assert.equal(third.unchanged, 2);
    assert.equal(f.records.get(productPath).currentStock, 88);
});
test('transaction retries recalculate codes from concurrent destination changes', async () => {
    const f = fixture();
    f.retry();
    await f.transfer(f.productRequest);
    assert.equal(newProducts(f)[0].code, 101);
});
test('failed commits do not write records or return false item success', async () => {
    const f = fixture();
    const before = structuredClone(f.records);
    f.fail();
    await assert.rejects(f.transfer(f.productRequest));
    assert.deepEqual(f.records, before);
    assert.deepEqual(f.writes, []);
});
test('reports item-level partial success for a selected record that was deleted', async () => {
    const f = fixture();
    const result = await f.transfer({ ...f.categories, categoryIds: ['c1', 'deleted'] });
    assert.equal(result.created, 1);
    assert.equal(result.skipped, 1);
    assert.equal(f.writes.length, 1);
});
test('rejects field/value injection, stock, history, source codes and malformed selections before database access', async () => {
    for (const field of ['currentStock', 'code', 'priceTable', 'history', 'id', 'Price 1']) {
        const f = fixture();
        f.productRequest.products[0].fields.push(field);
        await assert.rejects(f.transfer(f.productRequest), { status: 422 });
        assert.deepEqual(f.reads, []);
    }
    const f = fixture();
    await assert.rejects(f.transfer({ ...f.productRequest, arbitraryField: 1 }), { status: 422 });
    await assert.rejects(f.transfer({ ...f.productRequest, products: [{ ...f.productRequest.products[0], price: 999 }] }), { status: 422 });
    await assert.rejects(f.transfer({ ...f.productRequest, destinationOutletId: 'source' }), { status: 422 });
    assert.deepEqual(f.writes, []);
});
test('products without a category, or with a deleted source category, transfer with no category so they list under All', async () => {
    for (const category of [undefined, '', 'deleted-category']) {
        const f = fixture();
        Object.assign(f.records.get('OUTLET/source/PRODUCT/p1'), { category });
        f.productRequest.categoryMappings = {};
        const fields = typeof category === 'string' ? requiredFields : requiredFields.filter(field => field !== 'category');
        const result = await f.transfer({ ...f.productRequest, products: [{ sourceProductId: 'p1', fields }] });
        assert.equal(result.created, 1);
        assert.equal(newProducts(f)[0].category, '');
        assert.ok(!f.writes.some(path => path.includes('/CATEGORY/')));
    }
});
test('unresolved/foreign category mappings, missing source fields and malformed tax/unit values cannot create products', async () => {
    const f = fixture();
    await assert.rejects(f.transfer({ ...f.productRequest, categoryMappings: { c1: 'foreign-category' } }), { status: 422 });
    const missing = fixture();
    missing.productRequest.categoryMappings = {};
    assert.equal((await missing.transfer(missing.productRequest)).skipped, 1);
    for (const change of [{ taxIndex: -1 }, { unitId: 1.5 }, { name: undefined }]) {
        const g = fixture();
        Object.assign(g.records.get('OUTLET/source/PRODUCT/p1'), change);
        assert.equal((await g.transfer(g.productRequest)).skipped, 1);
        assert.deepEqual(g.writes, []);
    }
});
test('both outlet assignments and current active account are rechecked inside the transaction', async () => {
    for (const profile of [{ active: false, outlets: ['source', 'destination'] }, { active: true, outlets: ['source'] }, { active: true, outlets: ['destination'] }]) {
        const f = fixture();
        f.records.set('USER_PROFILE/user', profile);
        await assert.rejects(f.transfer(f.productRequest), { status: 403 });
        assert.deepEqual(f.writes, []);
    }
});
test('grants are short-lived and bound to the user, source and destination; normal session tokens cannot authorize transfers', async (t) => {
    const f = fixture();
    const normalToken = jwt.sign({ profileDocId: 'user' }, secret);
    for (const grant of ['', normalToken, issueTransferAuthorization(secret, 'other', 'source', 'destination'),
        issueTransferAuthorization(secret, 'user', 'other', 'destination'), issueTransferAuthorization(secret, 'user', 'source', 'other')]) {
        await assert.rejects(f.transfer(f.productRequest, grant), { status: 403 });
    }
    await assert.rejects(f.transfer(f.productRequest, f.grant, null), { status: 401 });
    assert.deepEqual(f.reads, []);
    const payload = jwt.decode(f.grant);
    assert.equal(payload.exp - payload.iat, 300);
    assert.ok(!('profileDocId' in payload));
    t.mock.method(Date, 'now', () => (payload.exp + 1) * 1000);
    assert.throws(() => requireTransferAuthorization(secret, f.grant, 'user', 'source', 'destination'), { status: 403 });
});
test('transfer grants fail closed if the existing server signing key is missing or too short', () => {
    for (const key of ['', 'web-pos-secret-key-2026']) {
        assert.throws(() => issueTransferAuthorization(key, 'user', 'source', 'destination'), { status: 503 });
        assert.throws(() => requireTransferAuthorization(key, '', 'user', 'source', 'destination'), { status: 503 });
    }
});
test('category number collisions allocate sequentially after destination maximum without changing either source or existing destination records', async () => {
    const f = fixture();
    for (let i = 1; i <= 10; i++)
        f.records.set(`OUTLET/destination/CATEGORY/existing${i}`, { name: `Existing ${i}`, categoryNo: i });
    const before = structuredClone(f.records);
    const result = await f.transfer(f.categories);
    assert.equal(result.created, 2);
    assert.equal(result.skipped, 0);
    assert.deepEqual(result.items.map(item => item.destinationNumber), [11, 12]);
    assert.deepEqual(f.writes.map(path => f.records.get(path).categoryNo), [11, 12]);
    for (const [path, fields] of before)
        assert.deepEqual(f.records.get(path), fields);
    assert.equal((await f.transfer(f.categories)).created, 0);
    assert.equal(f.writes.length, 2);
});
test('gaps and custom category numbers use maximum plus one', async () => {
    const f = fixture();
    f.records.set('OUTLET/destination/CATEGORY/custom', { name: 'Custom', categoryNo: 300 });
    await f.transfer(f.categories);
    assert.deepEqual(f.writes.map(path => f.records.get(path).categoryNo), [301, 302]);
});
test('colliding source product codes do not prevent sequential copies', async () => {
    const f = fixture();
    f.records.get('OUTLET/source/PRODUCT/p1').code = 20;
    f.records.set('OUTLET/source/PRODUCT/p2', { ...f.records.get('OUTLET/source/PRODUCT/p1'), name: 'Second product', barcode: 'OTHER-SOURCE' });
    f.productRequest.products.push({ sourceProductId: 'p2', fields: [...requiredFields] });
    const result = await f.transfer(f.productRequest);
    assert.equal(result.created, 2);
    assert.deepEqual(newProducts(f).map(product => product.code), [21, 22]);
});
test('transaction retries recalculate sequential category numbers from concurrent changes', async () => {
    const f = fixture();
    f.retry();
    const result = await f.transfer(f.categories);
    assert.deepEqual(result.items.map(item => item.destinationNumber), [101, 102]);
});
const none = { stock: false, weighable: false, images: true, taxes: false, prices: false, barcode: false };
const withOptions = (f, options, request = f.productRequest) => f.transfer({ ...request, options: { ...none, ...options } });
test('transfer options: none selected keeps the original zero-stock, default-field behavior', async () => {
    const f = fixture();
    await withOptions(f, {});
    const product = newProducts(f)[0];
    assert.equal(product.currentStock, 0);
    assert.equal(product.stockable, false);
    assert.equal(product.weighable, false);
    assert.equal(product.price, 0);
    assert.equal(product.mrpPrice, 0);
    assert.equal(product.hsnCode, '');
    assert.equal(product.cess, 0);
    assert.deepEqual(JSON.parse(String(product.priceTable)), { 'default price': 0 });
});
test('transfer options: each option copies only its own verified fields', async () => {
    const stock = fixture();
    await withOptions(stock, { stock: true });
    let product = newProducts(stock)[0];
    assert.equal(product.currentStock, 999);
    assert.equal(product.stockable, true);
    assert.equal(product.weighable, false);
    assert.equal(product.price, 0);
    const weighable = fixture();
    await withOptions(weighable, { weighable: true });
    product = newProducts(weighable)[0];
    assert.equal(product.weighable, true);
    assert.equal(product.currentStock, 0);
    assert.equal(product.stockable, false);
    const taxes = fixture();
    taxes.records.get('OUTLET/source/PRODUCT/p1').cess = 2;
    await withOptions(taxes, { taxes: true });
    product = newProducts(taxes)[0];
    assert.equal(product.taxIndex, 1);
    assert.equal(product.hsnCode, '123');
    assert.equal(product.cess, 2);
    assert.equal(product.price, 0);
    const prices = fixture();
    Object.assign(prices.records.get('OUTLET/source/PRODUCT/p1'), { wholeSaleAmount: 0, onlinePrice: 50 });
    const priced = await withOptions(prices, { prices: true });
    product = newProducts(prices)[0];
    assert.equal(product.price, 45);
    assert.equal(product.mrpPrice, 60);
    assert.equal(product.costPrice, 20);
    assert.equal(product.wholeSaleAmount, 0);
    assert.equal(product.onlinePrice, 50);
    assert.equal(product.currentStock, 0);
    assert.equal(product.hsnCode, '');
    assert.deepEqual(JSON.parse(String(product.priceTable)), { 'default price': 45 });
    assert.match(priced.items[0].reason, /premises prices not copied.*other price/);
});
test('transfer options: premises prices copy only to matching destination premises', async () => {
    const f = fixture();
    f.records.set('OUTLET/source/PRODUCT/p1', { ...f.records.get('OUTLET/source/PRODUCT/p1'), priceTable: '{"default price":45,"AC Table price":30,"Garden price":25}' });
    f.records.set('OUTLET/destination/PREMISES/ac', { name: ' ac  table ' });
    const result = await withOptions(f, { prices: true });
    assert.deepEqual(JSON.parse(String(newProducts(f)[0].priceTable)), { 'default price': 45, 'AC Table price': 30 });
    assert.match(result.items[0].reason, /Garden price/);
});
test('transfer options: all five together, and missing optional source fields are handled safely', async () => {
    const f = fixture();
    f.records.get('OUTLET/source/PRODUCT/p1').cess = 1;
    await withOptions(f, { stock: true, weighable: true, images: true, taxes: true, prices: true });
    const product = newProducts(f)[0];
    assert.deepEqual([product.currentStock, product.stockable, product.weighable, product.hsnCode, product.cess, product.price, product.mrpPrice, product.costPrice], [999, true, true, '123', 1, 45, 60, 20]);
    const sparse = fixture();
    sparse.records.set('OUTLET/source/PRODUCT/p1', { name: 'Sparse', category: 'c1', taxIndex: 1, unitId: 2 });
    const result = await withOptions(sparse, { stock: true, weighable: true, images: true, taxes: true, prices: true });
    const created = newProducts(sparse)[0];
    assert.equal(result.created, 1);
    assert.equal(created.currentStock, 0);
    assert.equal(created.weighable, false);
    assert.equal(created.price, 0);
    assert.match(result.items[0].reason, /source stock unavailable/);
});
test('transfer options: price table disagreement still skips; products without a price table use their Selling Price', async () => {
    const price = fixture();
    price.records.get('OUTLET/source/PRODUCT/p1').priceTable = '{"default price":40}';
    const priced = await withOptions(price, { prices: true });
    assert.equal(priced.created, 0);
    assert.match(priced.items[0].reason, /default price table must agree/);
    for (const priceTable of ['', undefined]) {
        const empty = fixture();
        Object.assign(empty.records.get('OUTLET/source/PRODUCT/p1'), { priceTable, price: 0 });
        assert.equal((await withOptions(empty, { prices: true })).created, 1);
        assert.deepEqual(JSON.parse(String(newProducts(empty)[0].priceTable)), { 'default price': 0 });
    }
});
test('combo and raw-material products keep their type, tax 0 and Android units outside the web unit list', async () => {
    const f = fixture();
    Object.assign(f.records.get('OUTLET/source/PRODUCT/p1'), { type: 2, taxIndex: 0, unitId: 13 });
    assert.equal((await withOptions(f, { taxes: true })).created, 1);
    const product = newProducts(f)[0];
    assert.equal(product.type, 2);
    assert.equal(product.taxIndex, 0);
    assert.equal(product.unitId, 13);
});
test('transfer options: Images unchecked creates the product without image fields and touches no storage', async () => {
    const f = fixture();
    f.records.get('OUTLET/source/PRODUCT/p1').imagePath = 'sensible_images/OUTLET/source/PRODUCT_IMAGES/p1/abc123.png';
    const { bucket, objects } = fakeStorage();
    const result = await transferOutletMastersWithStorage(f.db, 'source', 'user', assignment, secret, f.grant, { ...f.productRequest, options: { ...none, images: false } }, bucket);
    const product = newProducts(f)[0];
    assert.equal(result.created, 1);
    assert.ok(!('image' in product) && !('imagePath' in product));
    assert.equal(objects.size, 0);
    const invalid = fixture();
    invalid.records.get('OUTLET/source/PRODUCT/p1').image = 'not/a valid reference';
    assert.equal((await withOptions(invalid, { images: false })).created, 1);
});
test('transfer options: category transfer applies options to linked products; retries never add stock twice', async () => {
    const f = fixture();
    const request = { ...f.categories, categoryIds: ['c1'], products: [{ sourceProductId: 'p1', fields: [...requiredFields] }] };
    const first = await withOptions(f, { stock: true, weighable: true, prices: true }, request);
    assert.equal(first.created, 2);
    const product = newProducts(f)[0];
    assert.deepEqual([product.currentStock, product.weighable, product.price], [999, true, 45]);
    f.records.get('OUTLET/source/PRODUCT/p1').currentStock = 5;
    const again = await withOptions(f, { stock: true, weighable: true, prices: true }, request);
    assert.equal(again.created, 0);
    assert.equal(newProducts(f).length, 1);
    assert.equal(f.records.get(f.writes.find(path => path.includes('/PRODUCT/'))).currentStock, 999);
    assert.equal(f.records.get('OUTLET/source/PRODUCT/p1').currentStock, 5, 'source stock is never changed');
});
test('transfer options: invalid option payloads and unauthorized requests are rejected without writes', async () => {
    const f = fixture();
    for (const options of [{ stock: 'yes' }, { ...none, extra: true }, { stock: true }, null]) {
        await assert.rejects(f.transfer({ ...f.productRequest, options }), (error) => error.status === 422);
    }
    await assert.rejects(f.transfer({ ...f.productRequest, options: none }, 'bad-grant'), (error) => error.status === 403);
    assert.equal(f.writes.length, 0);
    const g = fixture();
    await assert.rejects(g.transfer({ ...g.productRequest, options: none }, g.grant, null), (error) => error.status === 401);
    assert.equal(g.writes.length, 0);
});
test('taxes are copied from the source product without reading TAX_MASTER', async () => {
    const f = fixture();
    f.records.get('OUTLET/source/PRODUCT/p1').taxIndex = 9;
    const result = await withOptions(f, { taxes: true });
    assert.equal(result.created, 1);
    assert.equal(newProducts(f)[0].taxIndex, 9);
    assert.ok(!f.reads.some(path => path.includes('TAX_MASTER')));
});
test('Category Transfer adds nothing to a category already present in the destination', async () => {
    const f = fixture();
    f.records.set('OUTLET/destination/CATEGORY/existing', { name: 'Coffee', categoryNo: 100 });
    const before = structuredClone(f.records);
    const result = await f.transfer({ ...f.categories, categoryIds: ['c1'], products: [{ sourceProductId: 'p1', fields: [...requiredFields] }] });
    assert.equal(result.items[0].status, 'already-transferred');
    assert.equal(result.created, 0);
    assert.equal(result.items[1].status, 'skipped');
    assert.match(result.items[1].reason, /category is already present/);
    assert.deepEqual(f.records, before);
    assert.deepEqual(f.writes, []);
});
test('a repeated Category Transfer reports everything as already present and adds no new products', async () => {
    const f = fixture();
    const request = { ...f.categories, categoryIds: ['c1'], products: [{ sourceProductId: 'p1', fields: [...requiredFields] }] };
    assert.equal((await f.transfer(request)).created, 2);
    f.records.set('OUTLET/source/PRODUCT/p9', { name: 'New coffee', category: 'c1', taxIndex: 1, unitId: 2 });
    const again = await f.transfer({ ...request, products: [...request.products, { sourceProductId: 'p9', fields: [...requiredFields] }] });
    assert.equal(again.created, 0);
    assert.equal(again.unchanged, 2);
    assert.match(again.items.find(item => item.sourceId === 'p9').reason, /category is already present/);
    assert.equal(newProducts(f).length, 1);
});
test('barcode option copies source barcodes for products and linked category products only when enabled', async () => {
    for (const mode of ['products', 'categories'])
        for (const barcode of [false, true]) {
            const f = fixture();
            await withOptions(f, { barcode }, mode === 'products' ? f.productRequest : { ...f.categories, categoryIds: ['c1'], products: [{ sourceProductId: 'p1', fields: [...requiredFields] }] });
            const copied = newProducts(f)[0];
            assert.equal(copied.barcode, barcode ? 'BAR-1' : '');
            assert.equal(copied.currentStock, 0);
            assert.equal(f.records.get('OUTLET/source/PRODUCT/p1').barcode, 'BAR-1');
        }
});
test('barcode option retains existing barcode-conflict protection and never overwrites destination stock', async () => {
    const f = fixture();
    f.records.get('OUTLET/destination/PRODUCT/old').barcode = 'BAR-1';
    const before = structuredClone(f.records.get('OUTLET/destination/PRODUCT/old'));
    const result = await withOptions(f, { barcode: true });
    assert.equal(result.created, 0);
    assert.equal(newProducts(f).length, 0);
    assert.deepEqual(f.records.get('OUTLET/destination/PRODUCT/old'), before);
});
test('older five-option clients remain supported; invalid barcode options are rejected', async () => {
    const f = fixture();
    const { barcode: _barcode, ...legacyOptions } = none;
    await f.transfer({ ...f.productRequest, options: legacyOptions });
    assert.equal(newProducts(f)[0].barcode, '');
    const invalid = fixture();
    await assert.rejects(invalid.transfer({ ...invalid.productRequest, options: { ...none, barcode: 'true' } }), (error) => error.status === 422);
    assert.equal(invalid.writes.length, 0);
});
test('missing or invalid optional source barcode leaves the new barcode blank', async () => {
    for (const barcode of [undefined, null, 12345, 'x'.repeat(201)]) {
        const f = fixture();
        f.records.get('OUTLET/source/PRODUCT/p1').barcode = barcode;
        await withOptions(f, { barcode: true });
        assert.equal(newProducts(f)[0].barcode, '');
    }
});
//# sourceMappingURL=masterTransfer.test.js.map