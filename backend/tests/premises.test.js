import assert from 'node:assert/strict';
import test from 'node:test';
import { createOutletPremise, updateOutletPremise, premiseFields } from '../src/premises.js';
import { ANDROID_TAX_OPTIONS } from '../../shared/androidTaxes.js';
import { premisesTransactionRunner } from '../src/premisesFirestore.js';
const input = { requestId: '71000000-0000-4000-8000-000000000001', name: 'TABLE', code: 1,
    type: 'Table', tables: 1, range: 1, taxIndex: 2, userId: 'account', extraPriceFlag: false, price: 0 };
const assigned = (profile) => profile.outlets;
function fixture() {
    const records = new Map([
        ['USER_PROFILE/user', { active: true, outlets: ['outlet'] }],
        ['USER_PROFILE/account', { active: true, outlets: ['outlet'] }],
        ['OUTLET/outlet', { name: 'Outlet' }],
        ['OUTLET/outlet/PREMISES/existing', { code: 10, name: 'Existing', price: 0, id: null, custom: 'keep', createdTime: { seconds: 100, nanoseconds: 12 } }],
        ['MASTERS/masters/TAX_MASTER/gst', { type: 0, index: 2, percent: 5 }],
    ]);
    const writes = [];
    const reads = [];
    let lost = false;
    const run = async (work) => {
        const pending = [];
        const result = await work({
            read: async (path) => { reads.push(path); return records.get(path); },
            list: async (path) => {
                reads.push(path);
                return [...records].filter(([key]) => key.startsWith(`${path}/`) && key.split('/').length === path.split('/').length + 1)
                    .map(([key, fields]) => ({ documentId: key.split('/').at(-1), fields }));
            },
            create: (path, fields) => pending.push({ path, fields }),
            update: (path, fields) => pending.push({ path, fields, update: true }),
        });
        for (const entry of pending) {
            assert.equal(records.has(entry.path), entry.update === true);
            records.set(entry.path, { ...(entry.update ? records.get(entry.path) : {}), ...Object.fromEntries(Object.entries(entry.fields).map(([key, value]) => {
                    const wire = Object.entries(value)[0];
                    return [key, wire[0] === 'integerValue' ? Number(wire[1]) : wire[1]];
                })) });
            writes.push(entry);
        }
        if (lost) {
            lost = false;
            throw new Error('Lost response');
        }
        return result;
    };
    return { records, writes, reads, loseResponse: () => { lost = true; },
        update: (body, id = 'existing', outlet = 'outlet', user = 'user') => updateOutletPremise(run, outlet, id, user, assigned, body),
        save: (body = input, outlet = 'outlet', user = 'user') => createOutletPremise(run, outlet, user, assigned, body) };
}
test('premises creates exactly the supplied Android fields with explicit wire types and leaves existing records intact', async () => {
    const f = fixture();
    const before = structuredClone(f.records);
    const saved = await f.save();
    assert.equal(saved.fields.id, null);
    assert.equal(saved.fields.name, 'TABLE');
    for (const [path, value] of before)
        assert.deepEqual(f.records.get(path), value);
    assert.equal(f.writes.length, 1);
    assert.equal(f.writes[0].path, `OUTLET/outlet/PREMISES/${saved.documentId}`);
    const fields = f.writes[0].fields;
    assert.deepEqual(Object.keys(fields).sort(), ['code', 'createdTime', 'extraPriceFlag', 'id', 'name', 'price', 'range', 'tables', 'taxIndex', 'type', 'userId'].sort());
    for (const key of ['code', 'range', 'tables', 'taxIndex'])
        assert.match(fields[key].integerValue, /^\d+$/);
    assert.deepEqual(fields.price, { doubleValue: 0 });
    assert.deepEqual(fields.id, { nullValue: null });
    assert.deepEqual(fields.extraPriceFlag, { booleanValue: false });
    assert.deepEqual(fields.userId, { stringValue: 'account' });
    assert.ok(Number.isFinite(Date.parse(fields.createdTime.timestampValue)));
});
test('Table, Room and Bill keep their exact string values and decimal prices stay doubles', () => {
    for (const type of ['Table', 'Room', 'Bill']) {
        const fields = premiseFields({ ...input, type, price: 12.5 }, new Date('2026-10-22T07:24:07Z'));
        assert.deepEqual(fields.type, { stringValue: type });
        assert.deepEqual(fields.price, { doubleValue: 12.5 });
    }
});
test('repeat saves and a lost response do not create duplicate premises', async () => {
    const f = fixture();
    f.loseResponse();
    await assert.rejects(f.save(), /Lost response/);
    const saved = await f.save();
    assert.equal((await f.save()).documentId, saved.documentId);
    assert.equal(f.writes.length, 1);
    await assert.rejects(f.save({ ...input, name: 'Changed' }), /already saved/);
    assert.equal(f.writes.length, 1);
});
test('invalid types, unknown fields, fractional integers and paths are rejected without database reads', async () => {
    for (const body of [{ ...input, code: '1' }, { ...input, code: 0 }, { ...input, tables: 1.5 }, { ...input, range: -1 },
        { ...input, taxIndex: 2.5 }, { ...input, price: -1 }, { ...input, price: Infinity }, { ...input, price: '0' },
        { ...input, extraPriceFlag: 'false' }, { ...input, id: 'forged' }, { ...input, userId: '../foreign' }, { ...input, type: 'table' }]) {
        const f = fixture();
        await assert.rejects(f.save(body));
        assert.deepEqual(f.writes, []);
        assert.deepEqual(f.reads, []);
    }
});
test('outlet access, assigned user and valid tax are required; duplicate codes cannot overwrite existing documents', async () => {
    for (const mode of ['session', 'foreign', 'inactive', 'account', 'tax', 'duplicate', 'missing']) {
        const f = fixture();
        if (mode === 'inactive')
            f.records.get('USER_PROFILE/user').active = false;
        if (mode === 'account')
            f.records.get('USER_PROFILE/account').outlets = ['other'];
        if (mode === 'missing')
            f.records.delete('OUTLET/outlet');
        await assert.rejects(f.save(mode === 'duplicate' ? { ...input, code: 10 } : mode === 'tax' ? { ...input, taxIndex: 999 } : input, mode === 'foreign' ? 'other' : 'outlet', mode === 'session' ? null : 'user'));
        assert.deepEqual(f.writes, [], mode);
        if (['session', 'foreign', 'inactive'].includes(mode))
            assert.ok(f.reads.every(path => path === 'USER_PROFILE/user'));
    }
});
test('typed REST transaction sends double zero, integer strings, null and timestamp without SDK numeric conversion', async () => {
    const calls = [];
    const fetcher = async (url, init) => {
        assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer test-token');
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        calls.push({ url: String(url), body });
        if (String(url).endsWith(':beginTransaction'))
            return Response.json({ transaction: 'transaction+id=' });
        if (String(url).includes('?transaction='))
            return Response.json({ name: 'profile', fields: { active: { booleanValue: true }, outlets: { arrayValue: { values: [{ stringValue: 'outlet' }] } } } });
        if (String(url).endsWith(':runQuery'))
            return Response.json([{ document: { name: 'projects/test/databases/(default)/documents/OUTLET/outlet/PREMISES/old', fields: { code: { integerValue: '2' }, price: { doubleValue: 0 }, id: { nullValue: null } } } }]);
        if (String(url).endsWith(':commit'))
            return Response.json({});
        throw new Error('Unexpected request');
    };
    const run = premisesTransactionRunner('projects/test/databases/(default)', async () => 'test-token', fetcher);
    await run(async (transaction) => {
        assert.deepEqual(await transaction.read('USER_PROFILE/user'), { active: true, outlets: ['outlet'] });
        assert.deepEqual((await transaction.list('OUTLET/outlet/PREMISES'))[0].fields, { code: 2, price: 0, id: null });
        transaction.create('OUTLET/outlet/PREMISES/new', premiseFields(input, new Date('2026-10-22T07:24:07Z')));
    });
    const commit = calls.at(-1).body;
    assert.equal(commit.transaction, 'transaction+id=');
    assert.equal(commit.writes.length, 1);
    assert.deepEqual(commit.writes[0].currentDocument, { exists: false });
    assert.deepEqual(commit.writes[0].update.fields.price, { doubleValue: 0 });
    assert.deepEqual(commit.writes[0].update.fields.code, { integerValue: '1' });
    assert.ok(calls[1].url.includes('transaction=transaction%2Bid%3D'));
});
test('REST aborted commits rerun the whole transaction; validation failures roll back without committing', async () => {
    let begins = 0, commits = 0, rollbacks = 0, callbacks = 0;
    const fetcher = async (url) => {
        if (String(url).endsWith(':beginTransaction'))
            return Response.json({ transaction: `tx${++begins}` });
        if (String(url).endsWith(':rollback')) {
            rollbacks++;
            return Response.json({});
        }
        if (String(url).endsWith(':commit')) {
            commits++;
            return commits === 1 ? Response.json({ error: { status: 'ABORTED' } }, { status: 409 }) : Response.json({});
        }
        throw new Error('Unexpected request');
    };
    const run = premisesTransactionRunner('projects/test/databases/(default)', async () => 'token', fetcher);
    await run(async (transaction) => { callbacks++; transaction.create('OUTLET/outlet/PREMISES/new', premiseFields(input, new Date())); });
    assert.equal(callbacks, 2);
    assert.equal(commits, 2);
    assert.equal(rollbacks, 1);
    await assert.rejects(run(async () => { throw new Error('Invalid data'); }), /Invalid data/);
    assert.equal(commits, 2);
    assert.equal(rollbacks, 2);
});
test('premise edits update the existing document and preserve timestamps, null ID and unknown fields', async () => {
    const f = fixture();
    const before = structuredClone(f.records);
    const result = await f.update({ name: 'Updated', price: 25, range: 3, taxIndex: 6, extraPriceFlag: true });
    const path = 'OUTLET/outlet/PREMISES/existing';
    assert.equal(result.documentId, 'existing');
    assert.deepEqual(f.records.get(path), { ...before.get(path), name: 'Updated', price: 25, range: 3, taxIndex: 6, extraPriceFlag: true });
    for (const [key, value] of before)
        if (key !== path)
            assert.deepEqual(f.records.get(key), value);
    assert.deepEqual(f.writes[0].fields, { name: { stringValue: 'Updated' }, price: { doubleValue: 25 },
        range: { integerValue: '3' }, taxIndex: { integerValue: '6' }, extraPriceFlag: { booleanValue: true } });
    await f.update({ name: 'Updated', price: 25 });
    assert.equal(f.writes.length, 1, 'Same changes are a no-op');
    await f.update({ price: 0 });
    assert.deepEqual(f.writes[1].fields, { price: { doubleValue: 0 } });
});
test('updates reject immutable fields, invalid types, unavailable records, duplicate codes and unauthorized users', async () => {
    for (const changes of [{ id: 'new' }, { createdTime: 'new' }, { requestId: input.requestId }, { price: '0' },
        { tables: 1.5 }, { taxIndex: 999 }, { userId: 'foreign' }]) {
        const f = fixture();
        await assert.rejects(f.update(changes));
        assert.deepEqual(f.writes, []);
    }
    const f = fixture();
    await f.save();
    await assert.rejects(f.update({ code: 1 }), /already exists/);
    assert.equal(f.writes.length, 1);
    await assert.rejects(f.update({ name: 'Changed' }, 'missing'), /no longer exists/);
    for (const user of [null, 'inactive']) {
        await assert.rejects(f.update({ name: 'Changed' }, 'existing', 'outlet', user));
    }
    await assert.rejects(f.update({ name: 'Changed' }, 'existing', 'other'));
    assert.equal(f.writes.length, 1);
});
test('all Android GST and VAT choices save their exact numeric taxIndex without touching TAX_MASTER', async () => {
    assert.deepEqual(ANDROID_TAX_OPTIONS.map(tax => [tax.index, tax.name, tax.percent, tax.type]), [
        [1, 'GST 0', 0, 0], [2, 'GST 5', 5, 1], [3, 'GST 12', 12, 1], [4, 'GST 18', 18, 1],
        [5, 'GST 28', 28, 1], [6, 'VAT 22', 22, 2], [7, 'VAT 10', 10, 2], [8, 'GST 3', 3, 1],
        [9, 'GST 2', 2, 1], [10, 'GST 40', 40, 1], [11, 'GST 8', 8, 1], [12, 'GST 1', 1, 1],
    ]);
    for (const tax of ANDROID_TAX_OPTIONS) {
        const f = fixture();
        f.records.delete('MASTERS/masters/TAX_MASTER/gst');
        const result = await f.save({ ...input, taxIndex: tax.index });
        assert.equal(result.fields.taxIndex, tax.index);
        assert.ok(f.reads.every(path => !path.startsWith('MASTERS/')));
        assert.ok(f.writes.every(write => write.path.startsWith('OUTLET/outlet/PREMISES/')));
    }
});
test('REST updates require an existing document and mask only changed fields with explicit value types', async () => {
    let commit;
    const fetcher = async (url, init) => {
        if (String(url).endsWith(':beginTransaction'))
            return Response.json({ transaction: 'tx' });
        if (String(url).endsWith(':commit')) {
            commit = JSON.parse(String(init?.body));
            return Response.json({});
        }
        throw new Error('Unexpected request');
    };
    const run = premisesTransactionRunner('projects/test/databases/(default)', async () => 'token', fetcher);
    await run(async (transaction) => {
        transaction.update('OUTLET/outlet/PREMISES/existing', {
            price: { doubleValue: 0 }, taxIndex: { integerValue: '7' }, name: { stringValue: 'Updated' },
        });
    });
    assert.deepEqual(commit.writes[0].currentDocument, { exists: true });
    assert.deepEqual(commit.writes[0].updateMask, { fieldPaths: ['price', 'taxIndex', 'name'] });
    assert.deepEqual(commit.writes[0].update.fields.price, { doubleValue: 0 });
    assert.equal(commit.writes[0].update.name, 'projects/test/databases/(default)/documents/OUTLET/outlet/PREMISES/existing');
});
//# sourceMappingURL=premises.test.js.map