import assert from 'node:assert/strict';
import test from 'node:test';
import { listOutletCustomers, createOutletCustomer } from '../src/customers.js';
const assigned = (profile) => [...new Set([
        ...(Array.isArray(profile.outlets) ? profile.outlets : []),
        ...(Array.isArray(profile.outletList) ? profile.outletList : []), profile.outletId,
    ].filter((id) => typeof id === 'string'))];
const customer = { name: 'Existing Customer', contact: '9876543210', altContact: '', email: '', gstNo: '', address: '',
    creditLimit: 500, dayLimit: 30, balance: 75.25, birthdayDate: '', anniversaryDate: '', allowedCredit: true, code: 1, id: null };
const draft = { requestId: '11111111-1111-4111-8111-111111111111', name: 'New Customer', contact: '+91 98765 43211',
    altContact: '9876543212', email: 'new@example.com', gstNo: '27ABCDE1234F1Z5', address: 'Line one\nLine two',
    creditLimit: 1500.50, dayLimit: 15, balance: -25.75, birthdayDate: '1990-03-21', anniversaryDate: '2015-12-30', allowedCredit: true };
function fixture() {
    const records = new Map([
        ['OUTLET/outlet', { active: true }], ['OUTLET/foreign', { active: true }],
        ['USER_PROFILE/current', { active: true, outletId: 'outlet', name: 'Signed User', quickPin: 'SECRET' }],
        ['USER_PROFILE/colleague', { active: true, outlets: ['outlet'], outletList: ['outlet'], name: 'Colleague', quickPin: 'SECRET' }],
        ['USER_PROFILE/foreign-user', { active: true, outletId: 'foreign', name: 'Foreign User' }],
        ['USER_PROFILE/inactive', { active: false, outletId: 'outlet', name: 'Inactive User' }],
        ['OUTLET/outlet/CUSTOMER/existing', structuredClone(customer)],
        ['OUTLET/foreign/CUSTOMER/other', { ...customer, name: 'Foreign Person' }],
    ]);
    const reads = [], writes = [];
    let failCommit = false;
    function collection(path, filters = [], fields) {
        return { path, isCollection: true,
            doc: (id) => doc(`${path}/${id}`),
            where: (key, op, value) => collection(path, [...filters, [key, op, value]], fields),
            select: (...selected) => collection(path, filters, selected),
            get: async () => {
                reads.push(path);
                const docs = [...records].filter(([key, value]) => key.startsWith(path + '/') && key.split('/').length === path.split('/').length + 1
                    && filters.every(([field, op, expected]) => op === 'array-contains' ? Array.isArray(value[field]) && value[field].includes(expected) : value[field] === expected))
                    .map(([key, value]) => ({ id: key.split('/').at(-1), data: () => fields ? Object.fromEntries(fields.filter(f => f in value).map(f => [f, value[f]])) : structuredClone(value) }));
                return { docs, size: docs.length, empty: !docs.length };
            }, };
    }
    function doc(path) {
        return { path, id: path.split('/').at(-1), collection: (name) => collection(`${path}/${name}`),
            get: async () => { reads.push(path); return { exists: records.has(path), data: () => records.has(path) ? structuredClone(records.get(path)) : undefined }; }, };
    }
    const db = { collection,
        runTransaction: async (work) => {
            const pending = [];
            const result = await work({ get: (ref) => ref.get(), create: (ref, fields) => {
                    assert.ok(!records.has(ref.path), 'Never overwrite existing customer');
                    pending.push({ path: ref.path, fields });
                } });
            if (failCommit)
                throw new Error('DATABASE FAILURE');
            for (const write of pending) {
                records.set(write.path, structuredClone(write.fields));
                writes.push(write);
            }
            return result;
        },
    };
    return { db, records, reads, writes, fail: () => { failCommit = true; } };
}
test('reads only selected outlet customers and does not modify existing balances', async () => {
    const f = fixture();
    const before = structuredClone(f.records);
    const result = await listOutletCustomers(f.db, 'outlet', 'current', assigned);
    const { id: _id, code: _code, ...fields } = customer;
    assert.deepEqual(result, { customers: [{ documentId: 'existing', ...fields }] });
    assert.deepEqual(f.records, before);
    assert.deepEqual(f.writes, []);
    assert.ok(!JSON.stringify(result).includes('Foreign Person'));
    assert.deepEqual(f.reads, ['USER_PROFILE/current', 'OUTLET/outlet', 'OUTLET/outlet/CUSTOMER']);
});
test('empty outlet returns an empty list and creates no documents', async () => {
    const f = fixture();
    f.records.delete('OUTLET/outlet/CUSTOMER/existing');
    assert.deepEqual(await listOutletCustomers(f.db, 'outlet', 'current', assigned), { customers: [] });
    assert.deepEqual(f.writes, []);
});
test('persists all twelve requested values in one existing customer collection without financial side effects', async () => {
    const f = fixture();
    const before = structuredClone(f.records);
    const result = await createOutletCustomer(f.db, 'outlet', 'current', assigned, draft);
    const { requestId: _requestId, ...fields } = draft;
    assert.deepEqual(result, { documentId: result.documentId, ...fields });
    assert.match(result.documentId, /^[a-z0-9]{20}$/);
    assert.deepEqual(f.writes, [{ path: `OUTLET/outlet/CUSTOMER/${result.documentId}`,
            fields: { ...fields, id: result.documentId, code: 2, selected: false, outletId: null } }]);
    for (const [path, value] of before)
        assert.deepEqual(f.records.get(path), value);
    assert.equal(f.records.size, before.size + 1);
    assert.ok((await listOutletCustomers(f.db, 'outlet', 'current', assigned)).customers.some(row => row.documentId === result.documentId));
});
test('save retries return the same record without duplicates or overwrites', async () => {
    const f = fixture();
    const first = await createOutletCustomer(f.db, 'outlet', 'current', assigned, draft);
    assert.deepEqual(await createOutletCustomer(f.db, 'outlet', 'current', assigned, draft), first);
    assert.equal(f.writes.length, 1);
    await assert.rejects(createOutletCustomer(f.db, 'outlet', 'current', assigned, { ...draft, balance: 50 }), { status: 409 });
    assert.equal(f.writes.length, 1);
});
test('duplicate primary mobile is rejected while existing optional contact conventions remain supported', async () => {
    const f = fixture();
    await assert.rejects(createOutletCustomer(f.db, 'outlet', 'current', assigned, { ...draft, contact: '98765 43210' }), { status: 409 });
    assert.deepEqual(f.writes, []);
    const first = await createOutletCustomer(f.db, 'outlet', 'current', assigned, { ...draft, contact: '', altContact: '', allowedCredit: false });
    const second = await createOutletCustomer(f.db, 'outlet', 'current', assigned, { ...draft, requestId: '22222222-2222-4222-8222-222222222222', contact: '' });
    assert.notEqual(first.documentId, second.documentId);
    assert.equal(first.allowedCredit, false);
    assert.equal(second.altContact, draft.altContact);
});
test('unauthenticated, inactive, missing and cross-outlet identities cannot list or create', async () => {
    for (const [outlet, user, status] of [['outlet', null, 401], ['foreign', 'current', 403], ['outlet', 'inactive', 403], ['outlet', 'missing', 403], ['bad/path', 'current', 400]]) {
        const f = fixture();
        await assert.rejects(listOutletCustomers(f.db, outlet, user, assigned), { status });
        await assert.rejects(createOutletCustomer(f.db, outlet, user, assigned, draft), { status });
        assert.deepEqual(f.writes, []);
    }
    const f = fixture();
    f.records.delete('OUTLET/outlet');
    await assert.rejects(listOutletCustomers(f.db, 'outlet', 'current', assigned), { status: 404 });
    await assert.rejects(createOutletCustomer(f.db, 'outlet', 'current', assigned, draft), { status: 404 });
});
test('validates dates, emails, mobile fields, numeric types, checkbox and protected inputs', async () => {
    for (const patch of [{ contact: 'bad' }, { altContact: 'bad' }, { email: 'invalid' }, { creditLimit: '100' }, { creditLimit: NaN }, { balance: Infinity },
        { dayLimit: -1 }, { dayLimit: 1.5 }, { birthdayDate: '1990-02-30' }, { anniversaryDate: 'bad-date' }, { allowedCredit: 'true' },
        { outletId: 'foreign' }, { profileId: 'other' }, { id: 'other' }, { code: 999 }, { role: 'admin' }, { name: 'A'.repeat(201) }]) {
        const f = fixture();
        await assert.rejects(createOutletCustomer(f.db, 'outlet', 'current', assigned, { ...draft, ...patch }), { status: 422 });
        assert.deepEqual(f.writes, []);
    }
});
test('legacy nullable optional fields display safely without rewriting records', async () => {
    const f = fixture();
    f.records.set('OUTLET/outlet/CUSTOMER/existing', { ...customer, email: null, address: null, birthdayDate: null, anniversaryDate: null, altContact: null });
    const before = structuredClone(f.records);
    const result = (await listOutletCustomers(f.db, 'outlet', 'current', assigned)).customers[0];
    assert.equal(result.email, '');
    assert.equal(result.birthdayDate, '');
    assert.equal(result.anniversaryDate, '');
    assert.equal(result.contact, customer.contact);
    assert.deepEqual(f.records, before);
});
test('failed database commit does not create a customer or falsely report success', async () => {
    const f = fixture();
    const before = structuredClone(f.records);
    f.fail();
    await assert.rejects(createOutletCustomer(f.db, 'outlet', 'current', assigned, draft), /DATABASE FAILURE/);
    assert.deepEqual(f.writes, []);
    assert.deepEqual(f.records, before);
});
//# sourceMappingURL=customers.test.js.map