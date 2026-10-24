import assert from 'node:assert/strict';
import test from 'node:test';
import type { Firestore } from 'firebase-admin/firestore';
import { saveStockAdjustment } from '../src/stockAdjustment.js';
import { stockMovementRecord } from '../src/stockMovementReport.js';

const requestId = '71000000-0000-4000-8000-000000000001';
const path = 'OUTLET/outlet/PRODUCT/p1';
const assigned = (profile: Record<string, unknown>) => profile.outlets as string[];
function fixture() {
  const records = new Map<string, Record<string, unknown>>([
    ['USER_PROFILE/user', { active: true, outlets: ['outlet'] }],
    [path, { name: 'Tea', code: 15, currentStock: 10, price: 15, category: 'c1', custom: 'keep', stockable: true }],
    ['OUTLET/outlet/PRODUCT/p2', { name: 'Coffee', currentStock: 3.5, price: 25 }],
    ['OUTLET/other/PRODUCT/p1', { currentStock: 100 }],
  ]);
  const writes: { path: string; patch: Record<string, unknown>; create: boolean }[] = [];
  const reads: string[] = [];
  let fail = false, retry = false, failAfterCommit = false;
  const ref = (path: string): any => ({ path, id: path.split('/').at(-1), collection: (name: string) => ref(`${path}/${name}`), doc: (id: string) => ref(`${path}/${id}`) });
  let queue = Promise.resolve();
  const db = { collection: (name: string) => ref(name), runTransaction: (callback: any) => {
    const operation = queue.then(async () => {
      let pending: typeof writes = [];
      const transaction = {
        get: async (reference: any) => {
          assert.equal(pending.length, 0, 'All reads precede writes'); reads.push(reference.path);
          return { exists: records.has(reference.path), data: () => structuredClone(records.get(reference.path)) };
        },
        create: (reference: any, patch: Record<string, unknown>) => pending.push({ path: reference.path, patch, create: true }),
        update: (reference: any, patch: Record<string, unknown>) => pending.push({ path: reference.path, patch, create: false }),
      };
      let result = await callback(transaction);
      if (retry) { retry = false; pending = []; records.get(path)!.currentStock = 12; result = await callback(transaction); }
      if (fail) throw new Error('commit failure');
      for (const write of pending) {
        assert.equal(records.has(write.path), !write.create);
        records.set(write.path, write.create ? write.patch : { ...records.get(write.path), ...write.patch }); writes.push(write);
      }
      if (failAfterCommit) { failAfterCommit = false; throw new Error('response lost after commit'); }
      return result;
    });
    queue = operation.then(() => undefined, () => undefined); return operation;
  } } as unknown as Firestore;
  const payload = { requestId, direction: 'in', items: [{ productId: 'p1', quantity: 2, expectedStock: 10, remark: '' }] };
  return { records, writes, reads, payload, save: (body: unknown = payload, outlet = 'outlet', user: string | null = 'user') => saveStockAdjustment(db, outlet, user, assigned, body),
    fail: () => { fail = true; }, recover: () => { fail = false; }, retry: () => { retry = true; }, loseResponse: () => { failAfterCommit = true; } };
}

test('confirmed stock in changes only currentStock and writes a report-compatible movement using existing fields', async () => {
  const f = fixture(); const before = structuredClone(f.records);
  const result = await f.save(); assert.equal(result.alreadySaved, false);
  assert.deepEqual(f.records.get(path), { ...before.get(path), currentStock: 12 });
  for (const [key, value] of before) if (key !== path) assert.deepEqual(f.records.get(key), value);
  assert.deepEqual(f.writes.find(write => !write.create)!.patch, { currentStock: 12 });
  const data = f.records.get(`OUTLET/outlet/GOODS_RECEIVED/${result.documentId}`)!;
  assert.deepEqual(Object.keys(data).sort(), ['type', 'dayID', 'createDate', 'quantity', 'goodsReceivedItemBeanList'].sort());
  const report = stockMovementRecord(result.documentId, data);
  assert.equal(report.direction, 'in'); assert.equal(report.quantity, 2); assert.equal(report.items[0]!.productId, 'p1');
  assert.match(report.dayId, /^\d{4}-\d{2}-\d{2}$/);
});

test('stock out supports fractional quantities and records the selected remark without touching prices', async () => {
  const f = fixture();
  await f.save({ ...f.payload, direction: 'out', items: [{ productId: 'p2', quantity: 0.125, expectedStock: 3.5, remark: 'Damaged' }] });
  assert.equal(f.records.get('OUTLET/outlet/PRODUCT/p2')!.currentStock, 3.375);
  const movement = f.writes.find(write => write.create)!.patch;
  assert.equal(stockMovementRecord('id', movement).items[0]!.remark, 'Damaged');
  assert.equal(f.records.get('OUTLET/outlet/PRODUCT/p2')!.price, 25);
});

test('repeated and simultaneous confirmations apply once, and changed request reuse fails closed', async () => {
  const f = fixture(); const results = await Promise.all([f.save(), f.save(), f.save()]);
  assert.equal(results.filter(result => !result.alreadySaved).length, 1); assert.equal(f.records.get(path)!.currentStock, 12);
  assert.equal(f.writes.length, 2);
  await assert.rejects(f.save({ ...f.payload, items: [{ ...f.payload.items[0], quantity: 3 }] }), /already used/);
});

test('a lost response after commit retries without applying the stock again', async () => {
  const f = fixture(); f.loseResponse(); await assert.rejects(f.save(), /response lost/);
  assert.equal((await f.save()).alreadySaved, true); assert.equal(f.records.get(path)!.currentStock, 12); assert.equal(f.writes.length, 2);
});

test('multi-product saves validate every row before writing and competing confirmations cannot overwrite stock', async () => {
  const f = fixture();
  await assert.rejects(f.save({ ...f.payload, items: [...f.payload.items, { productId: 'p2', quantity: 1, expectedStock: 99, remark: '' }] }), /Stock changed/);
  assert.deepEqual(f.writes, []); assert.equal(f.records.get(path)!.currentStock, 10);
  const competing = { ...f.payload, requestId: '71000000-0000-4000-8000-000000000002' };
  const outcomes = await Promise.allSettled([f.save(), f.save(competing)]);
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(f.records.get(path)!.currentStock, 12); assert.equal(f.writes.length, 2);
});

test('failed commits are atomic and allow a safe retry', async () => {
  const f = fixture(); const before = structuredClone(f.records); f.fail();
  await assert.rejects(f.save(), /commit failure/); assert.deepEqual(f.records, before); assert.equal(f.writes.length, 0);
  f.recover(); await f.save(); assert.equal(f.records.get(path)!.currentStock, 12);
});

test('changed stock, transaction retries, insufficient stock, missing products and invalid stock block all writes', async () => {
  for (const mode of ['stale', 'retry', 'insufficient', 'missing', 'invalid']) {
    const f = fixture(); let body: unknown = f.payload;
    if (mode === 'stale') f.records.get(path)!.currentStock = 12;
    if (mode === 'retry') f.retry();
    if (mode === 'insufficient') body = { ...f.payload, direction: 'out', items: [{ productId: 'p1', quantity: 11, expectedStock: 10, remark: 'Issued' }] };
    if (mode === 'missing') f.records.delete(path);
    if (mode === 'invalid') f.records.get(path)!.currentStock = '10';
    await assert.rejects(f.save(body)); assert.deepEqual(f.writes, [], mode);
    assert.equal([...f.records.keys()].some(key => key.includes('GOODS_RECEIVED')), false);
  }
});

test('malformed quantities, duplicate products, unknown fields and missing stock-out remarks are rejected', async () => {
  const f = fixture();
  for (const body of [
    { ...f.payload, arbitrary: true }, { ...f.payload, direction: 'other' }, { ...f.payload, items: [] },
    { ...f.payload, items: [...f.payload.items, ...f.payload.items] }, { ...f.payload, direction: 'out' },
    ...[0, -1, 0.0001, NaN, Infinity, '2'].map(quantity => ({ ...f.payload, items: [{ ...f.payload.items[0], quantity }] })),
    { ...f.payload, items: [{ ...f.payload.items[0], productId: '../other' }] },
  ]) await assert.rejects(f.save(body));
  assert.deepEqual(f.writes, []); assert.deepEqual(f.reads, []);
});

test('signed identity and current active outlet assignment are required before product reads', async () => {
  for (const mode of ['session', 'inactive', 'foreign']) {
    const f = fixture();
    if (mode === 'inactive') f.records.get('USER_PROFILE/user')!.active = false;
    await assert.rejects(f.save(f.payload, mode === 'foreign' ? 'other' : 'outlet', mode === 'session' ? null : 'user'));
    assert.ok(f.reads.every(path => path === 'USER_PROFILE/user')); assert.deepEqual(f.writes, []);
  }
});
