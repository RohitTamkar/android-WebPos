import assert from 'node:assert/strict';
import test from 'node:test';
import { removeMasterImage } from '../src/imageStorage.js';
function fixture(initial) {
    const fields = { ...initial }, writes = [];
    let exists = true, fail = false, uncertain = false;
    const snapshot = () => ({ exists, get: (key) => fields[key] });
    const ref = { collection: () => ref, doc: () => ref };
    const db = { collection: () => ref, runTransaction: async (work) => {
            const pending = [];
            await work({ get: async () => snapshot(), update: (_ref, patch) => pending.push(patch) });
            if (fail)
                throw new Error('write failed');
            for (const patch of pending) {
                writes.push(patch);
                for (const [key, value] of Object.entries(patch)) {
                    if (key === 'imagePath')
                        delete fields.imagePath;
                    else
                        fields[key] = value;
                }
            }
            if (uncertain) {
                uncertain = false;
                throw new Error('response lost after commit');
            }
        } };
    return { fields, writes, run: (reviewed) => removeMasterImage(db, 'products', 'o', 'p', reviewed),
        missing: () => { exists = false; }, fail: () => { fail = true; }, uncertain: () => { uncertain = true; } };
}
test('reviewed removal clears filename and legacy path without changing unrelated fields', async () => {
    const f = fixture({ name: 'Tea', image: 'shared.png', imagePath: 'legacy/path', price: 12, stock: 7 });
    await f.run({ image: 'shared.png', imagePath: 'legacy/path' });
    assert.deepEqual(f.fields, { name: 'Tea', image: null, price: 12, stock: 7 });
    assert.deepEqual(Object.keys(f.writes[0]).sort(), ['image', 'imagePath']);
    // This helper has no Storage dependency and never deletes a shared object.
});
test('changed references are rejected before any removal write', async () => {
    const f = fixture({ image: 'new.png', imagePath: 'legacy/path' });
    await assert.rejects(f.run({ image: 'old.png', imagePath: 'legacy/path' }), /changed after confirmation/);
    assert.equal(f.fields.image, 'new.png');
    assert.equal(f.writes.length, 0);
});
test('failed writes preserve references and retries after uncertain commits are idempotent', async () => {
    const f = fixture({ image: 'shared.png' });
    f.fail();
    await assert.rejects(f.run({ image: 'shared.png', imagePath: null }));
    assert.equal(f.fields.image, 'shared.png');
    const g = fixture({ image: 'shared.png' });
    g.uncertain();
    await assert.rejects(g.run({ image: 'shared.png', imagePath: null }));
    await g.run({ image: 'shared.png', imagePath: null });
    assert.equal(g.writes.length, 1);
});
test('malformed reviews and missing products cannot cause writes', async () => {
    for (const reviewed of [{}, [], { image: 'a.png' }, { image: 'a.png', imagePath: 12 }, { image: 'a.png', imagePath: null, other: true }]) {
        const f = fixture({ image: 'a.png' });
        await assert.rejects(f.run(reviewed));
        assert.equal(f.writes.length, 0);
    }
    const f = fixture({ image: 'a.png' });
    f.missing();
    await assert.rejects(f.run({ image: 'a.png', imagePath: null }), /no longer exists/);
});
//# sourceMappingURL=productImageRemoval.test.js.map