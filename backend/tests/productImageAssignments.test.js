import assert from 'node:assert/strict';
import test from 'node:test';
import { assignProductImage } from '../src/productImageAssignments.js';
import { uploadMasterImage } from '../src/imageStorage.js';
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
const requestId = '10000000-0000-4000-8000-000000000001';
const assigned = (profile) => profile.outlets;
const target = (documentId, expectedImage = null, replaceExisting = false, expectedImagePath = null) => ({ documentId, expectedImage, expectedImagePath, replaceExisting });
const request = (targets = [target('a')], bytes = png) => ({ requestId, contentType: 'image/png', base64: bytes.toString('base64'), targets });
function fixture() {
    const documents = new Map([
        ['USER_PROFILE/user', { active: true, outlets: ['o'] }],
        ...['a', 'b', 'c'].map(id => [`OUTLET/o/PRODUCT/${id}`, { name: id, price: 12, currentStock: 9 }]),
        ['OUTLET/other/PRODUCT/foreign', { name: 'Foreign', image: 'foreign.png' }],
    ]);
    const updates = [];
    const fail = new Set(), uncertain = new Set();
    const ref = (path) => ({ path, doc: (id) => ref(`${path}/${id}`), collection: (id) => ref(`${path}/${id}`),
        get: async () => ({ exists: documents.has(path), data: () => documents.get(path), get: (field) => documents.get(path)?.[field] }) });
    const db = { collection: (id) => ref(id), runTransaction: async (fn) => {
            const writes = [];
            const result = await fn({ get: (value) => value.get(), update: (value, fields) => writes.push({ ref: value, fields }) });
            for (const write of writes) {
                if (fail.has(write.ref.path))
                    throw new Error('database offline');
                Object.assign(documents.get(write.ref.path), write.fields);
                updates.push({ path: write.ref.path, fields: write.fields });
                if (uncertain.delete(write.ref.path))
                    throw new Error('response lost after commit');
            }
            return result;
        } };
    const objects = new Map();
    let saves = 0, failSave = false, corruptRead = false;
    const bucket = { file: (path) => ({
            getMetadata: async () => { const stored = objects.get(path); if (!stored)
                throw { code: 404 }; return [{ size: stored.bytes.length, contentType: stored.type }]; },
            save: async (bytes, options) => {
                saves++;
                if (failSave)
                    throw new Error('storage failed');
                assert.equal(options.preconditionOpts.ifGenerationMatch, 0);
                if (objects.has(path))
                    throw { code: 412 };
                objects.set(path, { bytes: Buffer.from(bytes), type: options.metadata.contentType });
            },
            getSignedUrl: async () => { const stored = objects.get(path); return [`data:image/png;base64,${(corruptRead ? Buffer.from('bad') : stored.bytes).toString('base64')}`]; },
        }) };
    return { db, bucket, documents, updates, objects, fail, uncertain, get saves() { return saves; },
        failStorage: () => { failSave = true; }, corrupt: () => { corruptRead = true; },
        run: (raw = request(), outlet = 'o', profile = 'user') => assignProductImage(db, bucket, outlet, profile, assigned, raw) };
}
test('one image assigned to one or three products uploads once and changes only filename image fields', async () => {
    for (const ids of [['a'], ['a', 'b', 'c']]) {
        const f = fixture();
        const result = await f.run(request(ids.map(id => target(id))));
        assert.equal(f.saves, 1);
        assert.equal(f.objects.size, 1);
        assert.match(result.image, /^[a-f0-9]{64}\.png$/);
        assert.deepEqual([...f.objects.keys()], [`product_images/${result.image}`]);
        assert.deepEqual(f.objects.get(`product_images/${result.image}`).bytes, png);
        assert.equal(result.results.every(item => item.status === 'saved'), true);
        for (const id of ids)
            assert.deepEqual(f.documents.get(`OUTLET/o/PRODUCT/${id}`), { name: id, price: 12, currentStock: 9, image: result.image });
        assert(f.updates.every(write => Object.keys(write.fields).join() === 'image'));
    }
});
test('partial failures preserve previous references; retry reuses the object and skips completed targets', async () => {
    const f = fixture();
    f.documents.get('OUTLET/o/PRODUCT/b').image = 'old.png';
    f.fail.add('OUTLET/o/PRODUCT/b');
    const raw = request([target('a'), target('b', 'old.png', true), target('c')]);
    const first = await f.run(raw);
    assert.deepEqual(first.results.map(item => item.status), ['saved', 'failed', 'saved']);
    assert.equal(f.documents.get('OUTLET/o/PRODUCT/b').image, 'old.png');
    f.fail.clear();
    const second = await f.run(raw);
    assert.deepEqual(second.results.map(item => item.status), ['unchanged', 'saved', 'unchanged']);
    assert.equal(first.image, second.image);
    assert.equal(f.saves, 1);
    assert.equal(f.updates.length, 3);
});
test('lost update responses are verified by reference on retry, without another upload or database write', async () => {
    const f = fixture();
    f.uncertain.add('OUTLET/o/PRODUCT/a');
    assert.equal((await f.run()).results[0].status, 'failed');
    assert.equal((await f.run()).results[0].status, 'unchanged');
    assert.equal(f.saves, 1);
    assert.equal(f.updates.length, 1);
});
test('explicit replacement and exact reviewed references are enforced; legacy fields stay intact', async () => {
    const f = fixture();
    const product = f.documents.get('OUTLET/o/PRODUCT/a');
    product.image = 'previous.png';
    product.imagePath = 'legacy/full/path';
    assert.equal((await f.run(request([target('a', 'previous.png', false, 'legacy/full/path')]))).results[0].status, 'failed');
    assert.equal(product.image, 'previous.png');
    assert.equal((await f.run(request([target('a', 'stale.png', true, 'legacy/full/path')]))).results[0].status, 'failed');
    const result = await f.run(request([target('a', 'previous.png', true, 'legacy/full/path')]));
    assert.equal(result.results[0].status, 'saved');
    assert.equal(product.imagePath, 'legacy/full/path');
});
test('upload or verification failure never changes product references or deletes shared objects', async () => {
    for (const corrupt of [false, true]) {
        const f = fixture();
        if (corrupt)
            f.corrupt();
        else
            f.failStorage();
        await assert.rejects(f.run(), /could not be verified/);
        assert.equal(f.updates.length, 0);
        assert.equal(f.documents.get('OUTLET/o/PRODUCT/a').image, undefined);
        assert.equal(f.objects.size, corrupt ? 1 : 0);
    }
});
test('exact byte limit and detected content type are independently enforced', async () => {
    const f = fixture();
    const boundary = Buffer.concat([png, Buffer.alloc(30720 - png.length)]);
    await f.run(request([target('a')], boundary));
    assert.equal([...f.objects.values()][0].bytes.length, 30720);
    await assert.rejects(f.run(request([target('b')], Buffer.concat([boundary, Buffer.alloc(1)]))));
    await assert.rejects(f.run({ ...request(), contentType: 'image/jpeg' }), /declared file type/);
    await assert.rejects(f.run({ ...request(), base64: '%%%=' }), /encoding/);
    assert.equal(f.saves, 1);
});
test('duplicates, arbitrary paths, missing products, inactive profiles and foreign outlets cannot update records', async () => {
    const f = fixture();
    await assert.rejects(f.run(request([target('a'), target('a')])), /only once/);
    await assert.rejects(f.run(request([target('../foreign')])));
    await assert.rejects(f.run(request(), 'other'));
    assert.equal(f.saves, 0);
    const foreign = await f.run(request([target('foreign')]));
    assert.equal(foreign.results[0].status, 'failed');
    assert.deepEqual(f.documents.get('OUTLET/other/PRODUCT/foreign'), { name: 'Foreign', image: 'foreign.png' });
    assert.equal(f.documents.has('OUTLET/o/PRODUCT/foreign'), false);
    f.documents.get('USER_PROFILE/user').active = false;
    await assert.rejects(f.run());
    assert.equal(f.updates.length, 0);
});
test('single-product retries verify uncertain commits and reuse one immutable object', async () => {
    const f = fixture();
    f.uncertain.add('OUTLET/o/PRODUCT/a');
    const operation = { requestId, expectedReference: null };
    const upload = () => uploadMasterImage(f.db, f.bucket, 'products', 'o', 'a', png, 'image/png', operation);
    await assert.rejects(upload(), /could not be confirmed/);
    const result = await upload();
    assert.equal(f.documents.get('OUTLET/o/PRODUCT/a').image, result.image);
    assert.equal(f.saves, 1);
    assert.equal(f.updates.length, 1);
    f.documents.get('OUTLET/o/PRODUCT/a').image = 'concurrent-edit.png';
    await assert.rejects(upload(), /saved image changed/);
    assert.equal(f.documents.get('OUTLET/o/PRODUCT/a').image, 'concurrent-edit.png');
    assert.equal(f.saves, 1);
});
test('single-product operation keeps legacy references and rejects malformed retry identifiers', async () => {
    const f = fixture();
    f.documents.get('OUTLET/o/PRODUCT/a').imagePath = 'legacy/full/path';
    const result = await uploadMasterImage(f.db, f.bucket, 'products', 'o', 'a', png, 'image/png', { requestId, expectedReference: 'legacy/full/path' });
    assert.equal(f.documents.get('OUTLET/o/PRODUCT/a').imagePath, 'legacy/full/path');
    assert.equal(f.documents.get('OUTLET/o/PRODUCT/a').image, result.image);
    await assert.rejects(uploadMasterImage(f.db, f.bucket, 'products', 'o', 'a', png, 'image/png', { requestId: '../unsafe', expectedReference: null }));
});
//# sourceMappingURL=productImageAssignments.test.js.map