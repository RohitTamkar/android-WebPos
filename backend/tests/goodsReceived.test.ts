import assert from 'node:assert/strict';
import test from 'node:test';
import { saveGoodsReceived, loadGoodsReceived } from '../src/goodsReceived.js';
import { premisesTransactionRunner } from '../src/premisesFirestore.js';
import type { PremisesTransactionRunner, TypedFields, FirestoreValue } from '../src/premises.js';
import type { Firestore } from 'firebase-admin/firestore';

function decode(value: FirestoreValue): unknown {
  if ('nullValue' in value) return null;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('mapValue' in value) return Object.fromEntries(Object.entries(value.mapValue.fields).map(([key, entry]) => [key, decode(entry)]));
  if ('arrayValue' in value) return value.arrayValue.values.map(decode);
  return 'stringValue' in value ? value.stringValue : value.timestampValue;
}
const assigned = (profile: Record<string, unknown>) => profile.outlets as string[];
const supplier = { id: 'S'.repeat(20), name: 'Gulbarga ', mobile: '00000', address: '', alternateNumber: null, email: '', gstin: '' };
const input = { documentId: 'R'.repeat(20), goodsReceivedNo: '38', supplier, items: [{ productId: 'product', quantity: 58, cost: 0, price: 23 }] };
const base = 'OUTLET/outlet/GOODS_RECEIVED';
function fixture() {
  const records = new Map<string, Record<string, unknown>>([
    ['USER_PROFILE/user', { active: true, outlets: ['outlet'] }],
    [`OUTLET/outlet/SUPPLIER/${supplier.id}`, { ...supplier, id: null, alternateNumber: '' }], ['OUTLET/outlet', { active: true }],
    ['OUTLET/outlet/PRODUCT/product', { name: 'IDLY', stockable: true, weighable: false, currentStock: 3, costPrice: 9, price: 23 }],
  ]);
  const writes: { path: string; fields: TypedFields }[] = [];
  let fail = false, lost = false, queue = Promise.resolve();
  const run: PremisesTransactionRunner = work => {
    const operation = queue.then(async () => {
      const pending: typeof writes = [];
      const result = await work({ read: async path => structuredClone(records.get(path)),
        list: async path => [...records].filter(([key]) => key.startsWith(`${path}/`)).map(([key, fields]) => ({ documentId: key.split('/').at(-1)!, fields: structuredClone(fields) })),
        create: (path, fields) => pending.push({ path, fields }), update: () => { throw new Error('No updates permitted'); } });
      if (fail) throw new Error('Commit failed');
      for (const write of pending) {
        assert.equal(records.has(write.path), false); records.set(write.path, Object.fromEntries(Object.entries(write.fields).map(([key, value]) => [key, decode(value)]))); writes.push(write);
      }
      if (lost) { lost = false; throw new Error('Response lost'); }
      return result;
    });
    queue = operation.then(() => undefined, () => undefined); return operation;
  };
  return { records, writes, run, fail: () => { fail = true; }, loseResponse: () => { lost = true; },
    save: (body: unknown = input, outlet = 'outlet', profile: string | null = 'user') => saveGoodsReceived(run, outlet, profile, assigned, body, () => new Date('2026-10-25T20:00:00Z')) };
}

test('receipt-only save preserves exact legacy nested fields, explicit numeric types and existing documents', async () => {
  const f = fixture(), before = structuredClone(f.records);
  await f.save(); assert.equal(f.writes.length, 1); assert.equal(f.writes[0]!.path, `${base}/${input.documentId}`);
  for (const [path, fields] of before) assert.deepEqual(f.records.get(path), fields);
  const fields = f.writes[0]!.fields;
  assert.deepEqual(Object.keys(fields).sort(), ['addType','createDate','dayID','finalTotal','formattedDate','goodsReceivedItemBeanList','goodsReceivedNo','id','quantity','remark','roundOff','state','supplier','total','type'].sort());
  assert.deepEqual(fields.createDate, { integerValue: String(Date.parse('2026-10-25T20:00:00Z')) });
  assert.deepEqual(fields.dayID, { stringValue: '2026-10-26' });
  for (const key of ['quantity','finalTotal','total','roundOff']) assert.deepEqual(fields[key], { doubleValue: 0 });
  for (const key of ['formattedDate','id','remark']) assert.deepEqual(fields[key], { nullValue: null });
  assert.deepEqual(fields.state, { integerValue: '0' });
  const line = (fields.goodsReceivedItemBeanList as { arrayValue: { values: { mapValue: { fields: TypedFields } }[] } }).arrayValue.values[0]!.mapValue.fields;
  assert.deepEqual(Object.keys(line).sort(), ['canWeight','cost','currentStock','id','name','price','productid','quantity','selected','state','total'].sort());
  assert.deepEqual(line.quantity, { doubleValue: 58 }); assert.deepEqual(line.currentStock, { doubleValue: 3 });
  assert.deepEqual(line.price, { doubleValue: 23 }); assert.deepEqual(line.cost, { doubleValue: 0 });
  assert.deepEqual(line.canWeight, { booleanValue: false }); assert.deepEqual(line.selected, { booleanValue: true });
  assert.deepEqual(f.records.get(`${base}/${input.documentId}`)!.supplier, supplier);
});
test('retry, simultaneous double-click and lost response create exactly one receipt', async () => {
  const f = fixture(); f.loseResponse(); await assert.rejects(f.save(), /Response lost/);
  const results = await Promise.all([f.save(), f.save()]); assert.ok(results.every(result => result.alreadySaved)); assert.equal(f.writes.length, 1);
  for (const body of [{ ...input, goodsReceivedNo: '39' }, { ...input, items: [{ ...input.items[0], quantity: 59 }] }, { ...input, supplier: { ...supplier, name: 'Other' } }]) await assert.rejects(f.save(body), /different receipt/);
});
test('duplicate receipt numbers, malformed fields, foreign/inactive outlets and invalid products cause no writes', async () => {
  const invalid = [{ ...input, items: [{ ...input.items[0], quantity: 0 }] }, { ...input, items: [{ ...input.items[0], cost: -1 }] },
    { ...input, items: [{ ...input.items[0], quantity: 0.0001 }] }, { ...input, items: [input.items[0], input.items[0]] },
    { ...input, supplier: { ...supplier, alternateNumber: '123' } }, { ...input, total: 100 }, { ...input, documentId: '../other' }];
  for (const body of invalid) { const f = fixture(); await assert.rejects(f.save(body)); assert.equal(f.writes.length, 0); }
  for (const mode of ['session','foreign','inactive','outlet','missing','stockable','stock']) {
    const f = fixture();
    if (mode === 'inactive') f.records.get('USER_PROFILE/user')!.active = false;
    if (mode === 'outlet') f.records.get('OUTLET/outlet')!.active = false;
    if (mode === 'missing') f.records.delete('OUTLET/outlet/PRODUCT/product');
    if (mode === 'stockable') f.records.get('OUTLET/outlet/PRODUCT/product')!.stockable = false;
    if (mode === 'stock') f.records.get('OUTLET/outlet/PRODUCT/product')!.currentStock = '3';
    await assert.rejects(f.save(input, mode === 'foreign' ? 'other' : 'outlet', mode === 'session' ? null : 'user')); assert.equal(f.writes.length, 0);
  }
  const f = fixture(); await f.save(); await assert.rejects(f.save({ ...input, documentId: 'AnotherReceipt123456' }), /receipt number/); assert.equal(f.writes.length, 1);
});
test('commit failures retain all existing data', async () => {
  const f = fixture(), before = structuredClone(f.records); f.fail(); await assert.rejects(f.save(), /Commit failed/); assert.deepEqual(f.records, before); assert.equal(f.writes.length, 0);
});
test('receipt loader reads the supplier master and generates IDs without any writes', async () => {
  let generated = 0;
  const ref = (path: string): any => ({ id: path.split('/').at(-1), collection: (name: string) => ref(`${path}/${name}`),
    doc: (id?: string) => ref(`${path}/${id ?? `GeneratedAutoId12345${++generated}`}`),
    get: async () => path.endsWith('/SUPPLIER') ? { docs: [{ id: supplier.id, data: () => ({ ...supplier, id: null, alternateNumber: '' }) }] } : path.endsWith('/GOODS_RECEIVED') ? { docs: [{ id: 'existing', data: () => ({ supplier, createDate: 123, goodsReceivedNo: '37' }) }] }
      : { exists: true, data: () => path.startsWith('USER_PROFILE/') ? { active: true, outlets: ['outlet'] } : { active: true } },
  });
  const db = { collection: (path: string) => ref(path) } as unknown as Firestore;
  const data = await loadGoodsReceived(db, 'outlet', 'user', assigned); assert.deepEqual(data.suppliers, [supplier]); assert.equal(data.receipts.length, 1); assert.equal(generated, 2);
});
test('REST transport sends a single create with explicit nested doubles and an exists:false precondition', async () => {
  const calls: { url: string; body: any }[] = [];
  const fetcher = async (url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')); calls.push({ url: String(url), body });
    if (String(url).endsWith(':beginTransaction')) return Response.json({ transaction: 'transaction' });
    if (String(url).endsWith(':runQuery')) return Response.json([]);
    if (String(url).endsWith(':commit')) return Response.json({});
    if (String(url).includes('USER_PROFILE/user?')) return Response.json({ fields: { active: { booleanValue: true }, outlets: { arrayValue: { values: [{ stringValue: 'outlet' }] } } } });
    if (String(url).includes(`/SUPPLIER/${supplier.id}?`)) return Response.json({ fields: { id: { nullValue: null }, name: { stringValue: supplier.name }, mobile: { stringValue: supplier.mobile }, address: { stringValue: '' }, alternateNumber: { stringValue: '' }, email: { stringValue: '' }, gstin: { stringValue: '' } } });
    if (String(url).includes('/PRODUCT/product?')) return Response.json({ fields: { name: { stringValue: 'IDLY' }, currentStock: { doubleValue: 3 }, stockable: { booleanValue: true }, weighable: { booleanValue: false } } });
    if (String(url).includes('/OUTLET/outlet?')) return Response.json({ fields: { active: { booleanValue: true } } });
    return Response.json({}, { status: 404 });
  };
  await saveGoodsReceived(premisesTransactionRunner('projects/test/databases/(default)', async () => 'test', fetcher as typeof fetch), 'outlet', 'user', assigned, input);
  const commit = calls.find(call => call.url.endsWith(':commit'))!.body;
  assert.equal(commit.writes.length, 1); assert.deepEqual(commit.writes[0].currentDocument, { exists: false });
  assert.ok(commit.writes[0].update.name.endsWith(`${base}/${input.documentId}`));
  assert.deepEqual(commit.writes[0].update.fields.goodsReceivedItemBeanList.arrayValue.values[0].mapValue.fields.quantity, { doubleValue: 58 });
  assert.ok(!commit.writes[0].updateMask);
});

test('receipt save rejects missing, foreign or changed supplier masters without writing', async () => {
  for (const mode of ['missing','changed','invalid']) { const f = fixture();
    if (mode === 'missing') f.records.delete(`OUTLET/outlet/SUPPLIER/${supplier.id}`);
    if (mode === 'changed') f.records.get(`OUTLET/outlet/SUPPLIER/${supplier.id}`)!.name = 'Changed';
    if (mode === 'invalid') f.records.get(`OUTLET/outlet/SUPPLIER/${supplier.id}`)!.id = supplier.id;
    await assert.rejects(f.save()); assert.equal(f.writes.length, 0);
  }
});
