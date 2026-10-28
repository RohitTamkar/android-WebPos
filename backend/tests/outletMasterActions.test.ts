import assert from 'node:assert/strict';
import test from 'node:test';
import type { Firestore } from 'firebase-admin/firestore';
import { deleteOutletMaster } from '../src/outletMasterDeletion.js';
import { updateOutletCustomer } from '../src/customers.js';

const assigned = (profile: Record<string, unknown>) => profile.outlets as string[];
function fixture() {
  const records = new Map<string, Record<string, unknown>>([
    ['USER_PROFILE/user', { active: true, outlets: ['outlet'] }], ['OUTLET/outlet', { active: true }],
    ['OUTLET/outlet/PREMISES/p', { name: 'AC', type: 'Table' }],
    ['OUTLET/outlet/EMPLOYEE/e', { name: 'Employee', userId: 'user' }],
    ['OUTLET/outlet/CUSTOMER/c', { name: 'Customer', contact: '98765', balance: 75, code: 12, id: 'keep', custom: 'keep' }],
    ['OUTLET/outlet/CUSTOMER/other', { name: 'Other', contact: '12345', balance: 100 }],
    ['OUTLET/outlet/PRODUCT/product', { priceTable: '{"AC price":100}' }],
    ['OUTLET/outlet/BILL/bill', { customerId: 'c', employeeId: 'e', total: 50 }],
    ['OUTLET/foreign/CUSTOMER/c', { name: 'Foreign' }],
  ]);
  const writes: { kind: string; path: string; fields?: Record<string, unknown> }[] = [];
  let fail = false;
  const ref = (path: string, collection = false): any => ({ path, collection: (name: string) => ref(`${path}/${name}`, true), doc: (id: string) => ref(`${path}/${id}`), isCollection: collection });
  const db = { collection: (name: string) => ref(name, true), runTransaction: async (work: any) => {
    const pending: typeof writes = [];
    const result = await work({
      get: async (reference: any) => {
        assert.equal(pending.length, 0, 'All reads happen before writes');
        if (reference.isCollection) return { docs: [...records].filter(([key]) => key.startsWith(`${reference.path}/`) && key.split('/').length === reference.path.split('/').length + 1)
          .map(([path, value]) => ({ id: path.split('/').at(-1), data: () => structuredClone(value) })) };
        return { exists: records.has(reference.path), data: () => structuredClone(records.get(reference.path)) };
      },
      delete: (reference: any) => pending.push({ kind: 'delete', path: reference.path }),
      update: (reference: any, fields: Record<string, unknown>) => { assert.ok(records.has(reference.path)); pending.push({ kind: 'update', path: reference.path, fields }); },
    });
    if (fail) throw new Error('COMMIT FAILED');
    for (const write of pending) { if (write.kind === 'delete') records.delete(write.path); else records.set(write.path, { ...records.get(write.path), ...write.fields }); writes.push(write); }
    return result;
  } } as unknown as Firestore;
  return { records, writes, db, fail: () => { fail = true; } };
}

test('deleting each master only removes its selected document and is safe to retry', async () => {
  for (const [collection, id] of [['PREMISES', 'p'], ['EMPLOYEE', 'e'], ['CUSTOMER', 'c']] as const) {
    const f = fixture(), before = structuredClone(f.records), path = `OUTLET/outlet/${collection}/${id}`;
    assert.deepEqual(await deleteOutletMaster(f.db, 'outlet', collection, id, 'user', assigned), { documentId: id, deleted: true });
    before.delete(path); assert.deepEqual(f.records, before);
    assert.deepEqual(await deleteOutletMaster(f.db, 'outlet', collection, id, 'user', assigned), { documentId: id, deleted: false });
    assert.deepEqual(f.writes, [{ kind: 'delete', path }]);
  }
});
test('master deletion rejects unauthorized paths, inactive access and failed commits without changes', async () => {
  for (const kind of ['session', 'foreign', 'path', 'inactive-profile', 'inactive-outlet', 'failure']) {
    const f = fixture();
    if (kind === 'inactive-profile') f.records.get('USER_PROFILE/user')!.active = false;
    if (kind === 'inactive-outlet') f.records.get('OUTLET/outlet')!.active = false;
    const before = structuredClone(f.records);
    if (kind === 'failure') f.fail();
    await assert.rejects(deleteOutletMaster(f.db, kind === 'foreign' ? 'foreign' : 'outlet', 'CUSTOMER', kind === 'path' ? '../c' : 'c', kind === 'session' ? null : 'user', assigned));
    assert.deepEqual(f.records, before); assert.deepEqual(f.writes, []);
  }
});
test('customer edits update submitted fields in place and preserve IDs, code, current balance and history', async () => {
  const f = fixture(); f.records.get('OUTLET/outlet/CUSTOMER/c')!.balance = 200;
  const before = structuredClone(f.records);
  const result = await updateOutletCustomer(f.db, 'outlet', 'c', 'user', assigned, { name: ' Updated ', email: 'updated@example.com', allowedCredit: false });
  assert.equal(result.name, 'Updated'); assert.equal(result.balance, 200);
  before.set('OUTLET/outlet/CUSTOMER/c', { ...before.get('OUTLET/outlet/CUSTOMER/c'), name: 'Updated', email: 'updated@example.com', allowedCredit: false });
  assert.deepEqual(f.records, before);
  assert.equal(f.writes.length, 1);
  const saved = structuredClone(f.records);
  await updateOutletCustomer(f.db, 'outlet', 'c', 'user', assigned, { name: ' Updated ', email: 'updated@example.com', allowedCredit: false });
  assert.deepEqual(f.records, saved);
});
test('customer edits validate fields, duplicates, missing records and authorization without creating documents', async () => {
  const f = fixture(), before = structuredClone(f.records);
  for (const body of [{ code: 1 }, { id: 'replace' }, { contact: '12345' }, { email: 'bad' }, { dayLimit: -1 }, { balance: '12' }, { unexpected: true }]) {
    await assert.rejects(updateOutletCustomer(f.db, 'outlet', 'c', 'user', assigned, body));
  }
  await assert.rejects(updateOutletCustomer(f.db, 'outlet', 'missing', 'user', assigned, { name: 'No create' }), { status: 404 });
  await assert.rejects(updateOutletCustomer(f.db, 'foreign', 'c', 'user', assigned, { name: 'No access' }), { status: 403 });
  await assert.rejects(updateOutletCustomer(f.db, 'outlet', 'c', null, assigned, { name: 'No session' }), { status: 401 });
  f.fail(); await assert.rejects(updateOutletCustomer(f.db, 'outlet', 'c', 'user', assigned, { name: 'No commit' }));
  assert.deepEqual(f.records, before); assert.deepEqual(f.writes, []);
});
