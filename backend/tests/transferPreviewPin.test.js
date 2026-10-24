import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyTransferPreviewPin } from '../src/transferPreviewPin.js';
let sequence = 0;
const assigned = (profile) => profile.outlets;
function fixture() {
    const id = `user-${++sequence}`;
    const records = new Map([
        [`USER_PROFILE/${id}`, { active: true, quickPin: '1234', outlets: ['source', 'destination'] }],
        ['OUTLET/source', { name: 'Source' }], ['OUTLET/destination', { name: 'Destination' }],
    ]);
    const reads = [];
    const db = { collection: (collection) => ({ doc: (document) => ({ get: async () => {
                    const key = `${collection}/${document}`;
                    reads.push(key);
                    return { exists: records.has(key), data: () => structuredClone(records.get(key)) };
                } }) }) };
    return { id, db, records, reads, verify: (body) => verifyTransferPreviewPin(db, 'source', id, assigned, body) };
}
const body = { destinationOutletId: 'destination', quickPin: '1234' };
test('verifies only the signed-in profile, returns no PIN, and never changes records', async () => {
    const f = fixture();
    const before = structuredClone(f.records);
    assert.deepEqual(await f.verify(body), { verified: true, destinationOutletId: 'destination' });
    assert.deepEqual(f.records, before);
    assert.deepEqual(f.reads, [`USER_PROFILE/${f.id}`, 'OUTLET/source', 'OUTLET/destination']);
});
test('supports the existing numeric QuickPin representation', async () => {
    const f = fixture();
    f.records.get(`USER_PROFILE/${f.id}`).quickPin = 1234;
    assert.equal((await f.verify(body)).verified, true);
});
test('wrong PIN does not verify or read outlet records', async () => {
    const f = fixture();
    await assert.rejects(f.verify({ ...body, quickPin: '9999' }), { status: 422 });
    assert.deepEqual(f.reads, [`USER_PROFILE/${f.id}`]);
});
test('missing/malformed stored PIN does not verify', async () => {
    for (const quickPin of [undefined, null, 'hash-or-secret', 0]) {
        const f = fixture();
        f.records.get(`USER_PROFILE/${f.id}`).quickPin = quickPin;
        await assert.rejects(f.verify(body), { status: 422 });
    }
});
test('validates source/destination and does not accept a forged identity or malformed PIN', async () => {
    for (const raw of [{ ...body, quickPin: '' }, { ...body, quickPin: '1234567' }, { ...body, destinationOutletId: 'bad/path' },
        { ...body, destinationOutletId: 'source' }, { ...body, profileId: 'another-user' }]) {
        const f = fixture();
        await assert.rejects(f.verify(raw), { status: 400 });
        assert.deepEqual(f.reads, []);
    }
});
test('authentication, active account, and access to both outlets are required', async () => {
    const f = fixture();
    await assert.rejects(verifyTransferPreviewPin(f.db, 'source', null, assigned, body), { status: 401 });
    assert.deepEqual(f.reads, []);
    for (const overrides of [{ active: false }, { outlets: ['source'] }, { outlets: ['destination'] }]) {
        const g = fixture();
        Object.assign(g.records.get(`USER_PROFILE/${g.id}`), overrides);
        await assert.rejects(g.verify(body), { status: 403 });
    }
});
test('removed destination cannot be opened', async () => {
    const f = fixture();
    f.records.delete('OUTLET/destination');
    await assert.rejects(f.verify(body), { status: 404 });
});
test('five incorrect attempts temporarily block further guesses', async () => {
    const f = fixture();
    for (let i = 0; i < 5; i++)
        await assert.rejects(f.verify({ ...body, quickPin: '9999' }), { status: 422 });
    await assert.rejects(f.verify(body), { status: 429 });
});
test('expired attempt limit permits verification again', async (t) => {
    const f = fixture();
    t.mock.method(Date, 'now', () => 1000);
    for (let i = 0; i < 5; i++)
        await assert.rejects(f.verify({ ...body, quickPin: '9999' }), { status: 422 });
    t.mock.method(Date, 'now', () => 302000);
    assert.equal((await f.verify(body)).verified, true);
});
//# sourceMappingURL=transferPreviewPin.test.js.map