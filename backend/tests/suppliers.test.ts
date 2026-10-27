import assert from 'node:assert/strict';
import test from 'node:test';
import { createOutletSupplier, receiptSupplierFromMaster } from '../src/suppliers.js';
import type { PremisesTransactionRunner, TypedFields } from '../src/premises.js';

const input = { documentId: 'S'.repeat(20), fields: { address: '', alternateNumber: '', email: '', gstin: 'Search Code ', mobile: '1555555555', name: 'datta' } };
const assigned = (profile: Record<string, unknown>) => profile.outlets as string[];
function fixture() {
  const records = new Map<string, Record<string, unknown>>([
    ['USER_PROFILE/user', { active: true, outlets: ['outlet'] }], ['OUTLET/outlet', { active: true }],
    ['OUTLET/outlet/PRODUCT/product', { currentStock: 80 }], ['OUTLET/outlet/GOODS_RECEIVED/existing', { type: 'STOCK-IN' }],
  ]);
  const writes: { path: string; fields: TypedFields }[] = [];
  let fail = false, lost = false, queue = Promise.resolve();
  const run: PremisesTransactionRunner = work => {
    const operation = queue.then(async () => {
      const pending: typeof writes = [];
      const result = await work({ read: async path => structuredClone(records.get(path)), list: async () => { throw new Error('No list needed'); },
        create: (path, fields) => pending.push({ path, fields }), update: () => { throw new Error('Updates prohibited'); } });
      if (fail) throw new Error('Commit failed');
      for (const write of pending) {
        assert.equal(records.has(write.path), false);
        records.set(write.path, Object.fromEntries(Object.entries(write.fields).map(([key, value]) => [key, 'nullValue' in value ? null : 'stringValue' in value ? value.stringValue : undefined])));
        writes.push(write);
      }
      if (lost) { lost = false; throw new Error('Response lost'); } return result;
    }); queue = operation.then(() => undefined, () => undefined); return operation;
  };
  return { records, writes, fail: () => { fail = true; }, loseResponse: () => { lost = true; },
    save: (body: unknown = input, outlet = 'outlet', user: string | null = 'user') => createOutletSupplier(run, outlet, user, assigned, body) };
}
test('supplier create writes exactly six strings and id:null only in the selected outlet SUPPLIER', async () => {
  const f = fixture(), before = structuredClone(f.records), result = await f.save();
  assert.equal(result.documentId, input.documentId); assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0]!.path, `OUTLET/outlet/SUPPLIER/${input.documentId}`);
  assert.deepEqual(Object.keys(f.writes[0]!.fields).sort(), ['address','alternateNumber','email','gstin','id','mobile','name']);
  for (const [key, value] of Object.entries(input.fields)) assert.deepEqual(f.writes[0]!.fields[key], { stringValue: value });
  assert.deepEqual(f.writes[0]!.fields.id, { nullValue: null });
  for (const [path, fields] of before) assert.deepEqual(f.records.get(path), fields);
});
test('supplier retries and concurrent confirmations never create a duplicate or overwrite a record', async () => {
  const f = fixture(); f.loseResponse(); await assert.rejects(f.save(), /Response lost/);
  const results = await Promise.all([f.save(), f.save()]); assert.ok(results.every(result => result.alreadySaved)); assert.equal(f.writes.length, 1);
  await assert.rejects(f.save({ ...input, fields: { ...input.fields, name: 'different' } }), /different supplier/); assert.equal(f.writes.length, 1);
});
test('wrong types, extra fields, invalid IDs and unauthorized outlets are rejected without writes', async () => {
  for (const body of [{ ...input, fields: { ...input.fields, alternateNumber: null } }, { ...input, fields: { ...input.fields, mobile: 1555555555 } },
    { ...input, fields: { ...input.fields, id: null } }, { ...input, fields: { ...input.fields, name: ' ' } },
    { ...input, documentId: '../wrong' }, { ...input, fields: { ...input.fields, shortName: 'not allowed' } }]) {
    const f = fixture(); await assert.rejects(f.save(body)); assert.equal(f.writes.length, 0);
  }
  for (const mode of ['session','foreign','inactive','outlet']) {
    const f = fixture(); if (mode === 'inactive') f.records.get('USER_PROFILE/user')!.active = false;
    if (mode === 'outlet') f.records.get('OUTLET/outlet')!.active = false;
    await assert.rejects(f.save(input, mode === 'foreign' ? 'other' : 'outlet', mode === 'session' ? null : 'user')); assert.equal(f.writes.length, 0);
  }
});
test('failed supplier commit leaves all records unchanged', async () => {
  const f = fixture(), before = structuredClone(f.records); f.fail(); await assert.rejects(f.save(), /Commit failed/); assert.deepEqual(f.records, before);
});
test('supplier document ID and receipt snapshot are separate from the stored id:null', () => {
  const master = { ...input.fields, id: null }, before = structuredClone(master);
  assert.deepEqual(receiptSupplierFromMaster(input.documentId, master), { ...input.fields, alternateNumber: null, id: input.documentId });
  assert.deepEqual(master, before); assert.equal(receiptSupplierFromMaster(input.documentId, { ...master, alternateNumber: null }), null);
});
