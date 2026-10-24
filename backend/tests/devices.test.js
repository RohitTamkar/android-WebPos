import assert from 'node:assert/strict';
import test from 'node:test';
import { listOutletDevices } from '../src/devices.js';
const assigned = (profile) => typeof profile.outletId === 'string' ? [profile.outletId] : [];
function fixture() {
    const records = new Map([
        ['USER_PROFILE/current', { active: true, outletId: 'outlet' }],
        ['USER_PROFILE/inactive', { active: false, outletId: 'outlet' }],
        ['OUTLET/outlet', { name: 'Database Outlet', privateField: 'SECRET' }],
        ['OUTLET/foreign', { name: 'Foreign Outlet' }],
        ['DEVICE/active-doc', { deviceId: 'DEVICE-A', active: true, outletId: 'outlet', outletName: 'Stale Name', quickPin: 'SECRET', loggedIn: false, latitude: 12 }],
        ['DEVICE/inactive-doc', { deviceId: 'DEVICE-B', active: false, outletId: 'outlet', loggedIn: true, connectedToNetwork: true }],
        ['DEVICE/foreign-doc', { deviceId: 'FOREIGN-DEVICE', active: true, outletId: 'foreign' }],
        ['DEVICE/unassigned-doc', { deviceId: 'UNASSIGNED-DEVICE', active: true, outletId: null }],
    ]);
    const reads = [], queries = [];
    let failure = false, leakForeign = false;
    const db = { collection: (name) => ({
            doc: (id) => ({ get: async () => {
                    reads.push(`${name}/${id}`);
                    if (failure)
                        throw new Error('PRIVATE DATABASE ERROR');
                    return { exists: records.has(`${name}/${id}`), data: () => structuredClone(records.get(`${name}/${id}`)) };
                } }),
            where: (field, op, value) => {
                assert.equal(name, 'DEVICE');
                assert.equal(field, 'outletId');
                assert.equal(op, '==');
                assert.equal(value, 'outlet');
                return { select: (...fields) => {
                        queries.push([name, field, op, value, fields]);
                        assert.deepEqual(fields, ['deviceId', 'active', 'outletId']);
                        return { get: async () => {
                                reads.push('DEVICE query');
                                const docs = [...records].filter(([path, data]) => path.startsWith('DEVICE/') && (leakForeign || data[field] === value)).map(([path, data]) => ({
                                    id: path.split('/')[1], data: () => Object.fromEntries(fields.filter(key => key in data).map(key => [key, data[key]])),
                                }));
                                return { docs };
                            } };
                    } };
            },
            // No write methods: accidental updates/creates/deletes fail immediately.
        }) };
    return { db, records, reads, queries, fail: () => { failure = true; }, leak: () => { leakForeign = true; } };
}
test('uses the current database outlet name and filters the existing root DEVICE collection', async () => {
    const f = fixture();
    const before = structuredClone(f.records);
    assert.deepEqual(await listOutletDevices(f.db, 'outlet', 'current', assigned), {
        outletName: 'Database Outlet', devices: [
            { documentId: 'active-doc', outletName: 'Database Outlet', deviceId: 'DEVICE-A', active: true },
            { documentId: 'inactive-doc', outletName: 'Database Outlet', deviceId: 'DEVICE-B', active: false },
        ],
    });
    assert.deepEqual(f.records, before);
    assert.equal(f.queries.length, 1);
});
test('returns no secrets, location, registration details or unrelated device fields', async () => {
    const f = fixture();
    const result = JSON.stringify(await listOutletDevices(f.db, 'outlet', 'current', assigned));
    for (const secret of ['SECRET', 'quickPin', 'latitude', 'loggedIn', 'connectedToNetwork', 'Stale Name'])
        assert.ok(!result.includes(secret));
});
test('rejects foreign and unassigned devices even if a query result contains them', async () => {
    const f = fixture();
    f.leak();
    const result = await listOutletDevices(f.db, 'outlet', 'current', assigned);
    assert.equal(result.devices.length, 2);
    assert.ok(result.devices.every(row => row.deviceId.startsWith('DEVICE-')));
});
test('missing or malformed active values stay unknown rather than becoming Inactive or online status', async () => {
    for (const active of [undefined, null, 'true', 'false', 0, 1]) {
        const f = fixture();
        f.records.set('DEVICE/active-doc', { deviceId: 'DEVICE-A', active, outletId: 'outlet', loggedIn: true, connectedToNetwork: true });
        const result = await listOutletDevices(f.db, 'outlet', 'current', assigned);
        assert.equal(result.devices.find(row => row.deviceId === 'DEVICE-A')?.active, null);
    }
});
test('uses the existing document device ID when the duplicated deviceId field is missing', async () => {
    const f = fixture();
    f.records.set('DEVICE/legacy-device', { outletId: 'outlet', active: true });
    assert.ok((await listOutletDevices(f.db, 'outlet', 'current', assigned)).devices.some(row => row.deviceId === 'legacy-device'));
});
test('empty lists remain empty and do not create documents', async () => {
    const f = fixture();
    f.records.delete('DEVICE/active-doc');
    f.records.delete('DEVICE/inactive-doc');
    const before = structuredClone(f.records);
    assert.deepEqual(await listOutletDevices(f.db, 'outlet', 'current', assigned), { outletName: 'Database Outlet', devices: [] });
    assert.deepEqual(f.records, before);
});
test('missing, inactive, unauthenticated and unassigned users cannot query device data', async () => {
    for (const [outlet, user, status] of [['outlet', null, 401], ['foreign', 'current', 403], ['outlet', 'inactive', 403], ['outlet', 'missing', 403], ['bad/path', 'current', 400]]) {
        const f = fixture();
        await assert.rejects(listOutletDevices(f.db, outlet, user, assigned), { status });
        assert.equal(f.queries.length, 0);
        if (!user)
            assert.deepEqual(f.reads, []);
    }
});
test('missing outlets and database failures cannot produce successful device lists', async () => {
    const f = fixture();
    f.records.delete('OUTLET/outlet');
    await assert.rejects(listOutletDevices(f.db, 'outlet', 'current', assigned), { status: 404 });
    assert.equal(f.queries.length, 0);
    const failing = fixture();
    failing.fail();
    await assert.rejects(listOutletDevices(failing.db, 'outlet', 'current', assigned), /PRIVATE DATABASE ERROR/);
});
//# sourceMappingURL=devices.test.js.map