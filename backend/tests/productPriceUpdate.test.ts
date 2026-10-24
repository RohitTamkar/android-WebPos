import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Firestore } from 'firebase-admin/firestore';
import { updateProductPrices } from '../src/productPriceUpdate.js';
import { ProductCreationError } from '../src/productCreation.js';
class Ref {
  constructor(public path: string) {}
  collection(name: string) { return new Ref(`${this.path}/${name}`); }
  doc(id: string) { return new Ref(`${this.path}/${id}`); }
}
const path = 'OUTLET/outlet/PRODUCT/p1';
function fixture(priceTable: unknown = '{"default price":80,"AC Table price":30,"TABLE price":80}') {
  const records = new Map<string, Record<string, unknown>>([
    ['USER_PROFILE/user', { active: true, outlets: ['outlet'] }],
    [path, { name: 'MASALA PAPAD', code: '1', price: 80, mrpPrice: 90, currentStock: 12, barcode: 'b', priceTable, custom: { keep: true } }],
    ['OUTLET/foreign/PRODUCT/p1', { name: 'Foreign', priceTable: '{"default price":1}' }],
  ]);
  const reads: string[] = [], updates: { path: string; fields: Record<string, unknown> }[] = [];
  const db = {
    collection: (name: string) => new Ref(name),
    async runTransaction(callback: (transaction: unknown) => Promise<unknown>) {
      const pending: typeof updates = [];
      const result = await callback({
        get: async (ref: Ref) => { reads.push(ref.path); return { exists: records.has(ref.path), data: () => records.get(ref.path) }; },
        update: (ref: Ref, fields: Record<string, unknown>) => pending.push({ path: ref.path, fields }),
      });
      for (const update of pending) { records.set(update.path, { ...records.get(update.path), ...update.fields }); updates.push(update); }
      return result;
    },
  };
  return { db: db as unknown as Firestore, records, reads, updates };
}
const assigned = (profile: Record<string, unknown>) => profile.outlets as string[];
const rejects = (promise: Promise<unknown>, status: number) => assert.rejects(promise, error => error instanceof ProductCreationError && error.status === status);

test('premise prices merge into the existing priceTable string, preserving key order and every other field', async () => {
  const f = fixture(); const before = structuredClone(f.records.get(path)!);
  const result = await updateProductPrices(f.db, 'outlet', 'p1', 'user', assigned,
    { prices: { 'AC Table price': 35 }, expected: { 'AC Table price': 30 } });
  assert.deepEqual(f.updates, [{ path, fields: { priceTable: '{"default price":80,"AC Table price":35,"TABLE price":80}' } }]);
  assert.deepEqual(f.records.get(path), { ...before, priceTable: '{"default price":80,"AC Table price":35,"TABLE price":80}' });
  assert.deepEqual(result, { documentId: 'p1', fields: f.records.get(path) });
});

test('default price also updates the price field; object tables stay objects', async () => {
  const f = fixture({ 'default price': 50 });
  await updateProductPrices(f.db, 'outlet', 'p1', 'user', assigned, { prices: { 'default price': 55.5 }, expected: { 'default price': 50 } });
  assert.deepEqual(f.updates[0]!.fields, { priceTable: { 'default price': 55.5 }, price: 55.5 });
});

test('retrying an applied update succeeds without change; a concurrent edit is rejected', async () => {
  const f = fixture(); const request = { prices: { 'TABLE price': 90 }, expected: { 'TABLE price': 80 } };
  await updateProductPrices(f.db, 'outlet', 'p1', 'user', assigned, request);
  const saved = structuredClone(f.records);
  await updateProductPrices(f.db, 'outlet', 'p1', 'user', assigned, request);
  assert.deepEqual(f.records, saved);
  await rejects(updateProductPrices(f.db, 'outlet', 'p1', 'user', assigned, { prices: { 'TABLE price': 70 }, expected: { 'TABLE price': 80 } }), 409);
  assert.deepEqual(f.records, saved);
});

test('unknown keys, invalid values, malformed tables and missing products never write', async () => {
  const f = fixture();
  for (const body of [{ prices: { 'Garden price': 10 }, expected: { 'Garden price': undefined } }, { prices: { 'TABLE price': -1 }, expected: { 'TABLE price': 80 } },
    { prices: { 'TABLE price': '90' }, expected: { 'TABLE price': 80 } }, { prices: { 'TABLE price': Infinity }, expected: { 'TABLE price': 80 } },
    { prices: { 'TABLE price': 90 }, expected: {} }, { prices: {}, expected: {} }, { prices: { 'TABLE price': 90 }, expected: { 'TABLE price': 80 }, price: 1 }, null]) {
    await rejects(updateProductPrices(f.db, 'outlet', 'p1', 'user', assigned, body), 422);
  }
  for (const table of ['invalid', '[]', null, 5]) {
    await rejects(updateProductPrices(fixture(table).db, 'outlet', 'p1', 'user', assigned, { prices: { 'default price': 1 }, expected: { 'default price': 80 } }), 422);
  }
  await rejects(updateProductPrices(f.db, 'outlet', 'absent', 'user', assigned, { prices: { 'default price': 1 }, expected: { 'default price': 1 } }), 404);
  assert.deepEqual(f.updates, []);
});

test('unauthorized sessions, outlets and paths are rejected before product reads', async () => {
  const f = fixture(); const body = { prices: { 'default price': 1 }, expected: { 'default price': 80 } };
  await rejects(updateProductPrices(f.db, 'outlet', 'p1', null, assigned, body), 401);
  await rejects(updateProductPrices(f.db, 'foreign', 'p1', 'user', assigned, body), 403);
  await rejects(updateProductPrices(f.db, 'outlet', 'p1', 'missing', assigned, body), 403);
  await rejects(updateProductPrices(f.db, 'bad/path', 'p1', 'user', assigned, body), 400);
  await rejects(updateProductPrices(f.db, 'outlet', '..', 'user', assigned, body), 400);
  f.records.set('USER_PROFILE/user', { active: false, outlets: ['outlet'] });
  await rejects(updateProductPrices(f.db, 'outlet', 'p1', 'user', assigned, body), 403);
  assert.ok(f.reads.every(read => read.startsWith('USER_PROFILE/'))); assert.deepEqual(f.updates, []);
});
