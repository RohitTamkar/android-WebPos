import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Firestore } from 'firebase-admin/firestore';
import { updateOutletProduct } from '../src/productUpdate.js';
import { ProductCreationError } from '../src/productCreation.js';
import { productFields } from '../src/productDefaults.js';
import { ANDROID_TAX_OPTIONS } from '../../shared/androidTaxes.js';
class Ref {
  constructor(public path: string, public query = false) {}
  collection(name: string) { return new Ref(`${this.path}/${name}`, true); }
  doc(id: string) { return new Ref(`${this.path}/${id}`); }
}
function fixture() {
  const original = { ...productFields({ name: 'Product', price: 50, mrpPrice: 60, costPrice: 20, category: 'c1',
    regionalName: 'Local', discount: 5, shortName: 'Short', taxIndex: 7, hsnCode: '123', unitId: 2,
    weighable: false, stockable: true }, 196, '000001234567'),
    code: '00196', id: 'legacy-stored-id', currentStock: 35, reorderLevel: 10, active: true, onlineSynced: true,
    selected: true, kitchenId: 'kitchen', dateTme: { timestamp: 'preserve' }, custom: { keep: true },
    priceTable: '{"default price":50,"Wholesale":40}' };
  const records = new Map<string, Record<string, unknown>>([
    ['USER_PROFILE/user', { active: true, outlets: ['outlet'] }],
    ['OUTLET/outlet/PRODUCT/p1', original], ['OUTLET/outlet/PRODUCT/p2', { code: 999, name: 'Other' }],
    ['OUTLET/outlet/CATEGORY/c1', { name: 'Food' }], ['OUTLET/outlet/CATEGORY/c2', { name: 'Drinks' }],
    ['MASTERS/masters/TAX_MASTER/gst', { percent: 5, index: 7, type: 0 }],
    ['MASTERS/masters/TAX_MASTER/zero', { percent: 0, index: 1, type: 0 }],
    ['OUTLET/foreign/PRODUCT/p1', { name: 'Foreign' }],
  ]);
  const reads: string[] = [], updates: { path: string; fields: Record<string, unknown> }[] = [];
  let fail = false;
  const db = {
    collection: (path: string) => new Ref(path, true),
    async runTransaction(callback: (transaction: unknown) => Promise<unknown>) {
      const pending: typeof updates = [];
      const result = await callback({
        get: async (ref: Ref) => {
          assert.equal(pending.length, 0); reads.push(ref.path);
          return ref.query ? { docs: [...records].filter(([path]) => path.startsWith(`${ref.path}/`) && path.split('/').length === ref.path.split('/').length + 1)
            .map(([path, fields]) => ({ id: path.split('/').at(-1)!, data: () => fields })) }
            : { exists: records.has(ref.path), data: () => records.get(ref.path) };
        },
        update: (ref: Ref, fields: Record<string, unknown>) => pending.push({ path: ref.path, fields }),
      });
      if (fail) throw new Error('database failure');
      for (const update of pending) {
        assert.ok(records.has(update.path), 'updates cannot recreate missing products');
        records.set(update.path, { ...records.get(update.path), ...update.fields }); updates.push(update);
      }
      return result;
    },
  };
  return { db: db as unknown as Firestore, records, reads, updates, fail: () => { fail = true; } };
}
const assigned = (profile: Record<string, unknown>) => profile.outlets as string[];
const path = 'OUTLET/outlet/PRODUCT/p1';

test('all Add Product editable fields update on the same document while all other fields and records survive', async () => {
  const f = fixture(); const before = structuredClone(f.records);
  const changes = { name: ' Product Updated ', price: 55.5, mrpPrice: 65, costPrice: 22, category: 'c2',
    regionalName: ' Local Updated ', discount: 10, shortName: ' NEW ', taxIndex: 1, hsnCode: ' 456 ',
    unitId: 2, weighable: true, stockable: false };
  const result = await updateOutletProduct(f.db, 'outlet', 'p1', 'user', assigned, changes);
  const expectedChanges = { ...changes, name: 'Product Updated', regionalName: 'Local Updated', shortName: 'NEW', hsnCode: '456',
    priceTable: '{"default price":55.5,"Wholesale":40}' };
  assert.deepEqual(f.updates, [{ path, fields: expectedChanges }]);
  before.set(path, { ...before.get(path), ...expectedChanges });
  assert.deepEqual(f.records, before);
  assert.deepEqual(result, { documentId: 'p1', fields: f.records.get(path) });
  assert.equal(result.fields.code, '00196'); assert.equal(result.fields.id, 'legacy-stored-id');
  assert.equal(result.fields.currentStock, 35); assert.equal(result.fields.barcode, '000001234567');
});

test('partial update, explicit empty optional text and unchecked flags never reset untouched values', async () => {
  const f = fixture();
  const result = await updateOutletProduct(f.db, 'outlet', 'p1', 'user', assigned, { shortName: '', stockable: false });
  assert.deepEqual(f.updates[0]!.fields, { shortName: '', stockable: false });
  assert.equal(result.fields.regionalName, 'Local'); assert.equal(result.fields.hsnCode, '123');
  assert.equal(result.fields.currentStock, 35); assert.equal(result.fields.priceTable, '{"default price":50,"Wholesale":40}');
  const snapshot = structuredClone(f.records);
  await updateOutletProduct(f.db, 'outlet', 'p1', 'user', assigned, {});
  assert.equal(f.updates.length, 1); assert.deepEqual(f.records, snapshot);
});

test('wholesale and online prices update only the existing numeric fields', async () => {
  const f = fixture(); const before = structuredClone(f.records.get(path));
  const result = await updateOutletProduct(f.db, 'outlet', 'p1', 'user', assigned, { wholeSaleAmount: 40, onlinePrice: 55 });
  assert.deepEqual(f.updates[0]!.fields, { wholeSaleAmount: 40, onlinePrice: 55 });
  assert.deepEqual(result.fields, { ...before, wholeSaleAmount: 40, onlinePrice: 55 });
  assert.equal(typeof result.fields.wholeSaleAmount, 'number'); assert.equal(typeof result.fields.onlinePrice, 'number');
  for (const change of [{ wholeSaleAmount: '40' }, { onlinePrice: '55' }, { onlinePrice: -1 }, { wholeSaleAmount: Infinity }]) {
    await assert.rejects(updateOutletProduct(f.db, 'outlet', 'p1', 'user', assigned, change));
  }
  assert.equal(f.updates.length, 1);
});

test('product edits accept the Android tax IDs and retain unknown saved IDs until explicitly changed', async () => {
  const f = fixture();
  f.records.set(path, { ...f.records.get(path), taxIndex: 99 });
  await updateOutletProduct(f.db, 'outlet', 'p1', 'user', assigned, { name: 'Changed' });
  assert.equal(f.records.get(path)!.taxIndex, 99);
  for (const tax of ANDROID_TAX_OPTIONS) {
    const result = await updateOutletProduct(f.db, 'outlet', 'p1', 'user', assigned, { taxIndex: tax.index });
    assert.equal(result.fields.taxIndex, tax.index);
  }
  assert.ok(f.reads.every(path => !path.startsWith('MASTERS/')));
  assert.ok(f.updates.every(update => update.path === path));
});

test('price changes preserve additional price levels; malformed existing tables block only price changes', async () => {
  for (const table of ['invalid', '{}', 'null', '[]', { 'default price': 50 }]) {
    const f = fixture(); f.records.set(path, { ...f.records.get(path), priceTable: table });
    await updateOutletProduct(f.db, 'outlet', 'p1', 'user', assigned, { regionalName: 'New' });
    assert.deepEqual(f.records.get(path)!.priceTable, table);
    const before = structuredClone(f.records);
    await assert.rejects(updateOutletProduct(f.db, 'outlet', 'p1', 'user', assigned, { price: 99 }),
      error => error instanceof ProductCreationError && error.status === 422 && !!error.errors.price);
    assert.deepEqual(f.records, before);
  }
});

test('immutable and unknown fields cannot be modified, and invalid numeric/reference data cannot save', async () => {
  const f = fixture(); const before = structuredClone(f.records);
  for (const changes of [{ code: 999 }, { id: 'new' }, { barcode: 123 }, { currentStock: 999 }, { active: false },
    { dateTme: 'new' }, { onlineSynced: false }, { priceTable: '{}' }, { unexpected: true }, { price: -1 },
    { mrpPrice: NaN }, { costPrice: Infinity }, { discount: 101 }, { name: '' }, { category: 'foreign' },
    { taxIndex: 999 }, { unitId: 999 }, { weighable: 'yes' }]) {
    await assert.rejects(updateOutletProduct(f.db, 'outlet', 'p1', 'user', assigned, changes),
      error => error instanceof ProductCreationError && error.status === 422);
  }
  assert.deepEqual(f.updates, []); assert.deepEqual(f.records, before);
});

test('unauthorized outlets, missing sessions, invalid paths and inactive users never read product details or write', async () => {
  const f = fixture();
  for (const [outlet, id, user, status] of [['outlet', 'p1', null, 401], ['foreign', 'p1', 'user', 403],
    ['outlet', 'p1', 'missing', 403], ['bad/path', 'p1', 'user', 400], ['outlet', 'a/b', 'user', 400]] as const) {
    await assert.rejects(updateOutletProduct(f.db, outlet, id, user, assigned, { name: 'New' }),
      error => error instanceof ProductCreationError && error.status === status);
  }
  f.records.set('USER_PROFILE/user', { active: false, outlets: ['outlet'] });
  await assert.rejects(updateOutletProduct(f.db, 'outlet', 'p1', 'user', assigned, { name: 'New' }), error => error instanceof ProductCreationError && error.status === 403);
  assert.ok(f.reads.every(ref => ref.startsWith('USER_PROFILE/'))); assert.deepEqual(f.updates, []);
});

test('deleted products cannot be recreated by update, failures preserve data, and retries never duplicate records', async () => {
  const f = fixture(); const before = structuredClone(f.records);
  await assert.rejects(updateOutletProduct(f.db, 'outlet', 'absent', 'user', assigned, { name: 'New' }), error => error instanceof ProductCreationError && error.status === 404);
  assert.deepEqual(f.records, before);
  f.fail(); await assert.rejects(updateOutletProduct(f.db, 'outlet', 'p1', 'user', assigned, { name: 'New' }), /database failure/);
  assert.deepEqual(f.records, before);
  const good = fixture(); const patch = { price: 55, name: 'New' };
  await updateOutletProduct(good.db, 'outlet', 'p1', 'user', assigned, patch);
  const saved = structuredClone(good.records);
  await updateOutletProduct(good.db, 'outlet', 'p1', 'user', assigned, patch);
  assert.deepEqual(good.records, saved);
});

test('barcode, online and premises prices and an existing service point update together without replacing other prices', async () => {
  const f = fixture();
  f.records.set('OUTLET/outlet/SERVICE_POINT/bar', { name: 'Bar' });
  f.records.set('OUTLET/outlet/PREMISES/ac', { name: 'AC Table' });
  const result = await updateOutletProduct(f.db, 'outlet', 'p1', 'user', assigned, {
    barcode: '0000098765', kitchenId: 'bar', onlinePrice: 90, price: 75,
    premisesPrices: { 'AC Table price': 80, Wholesale: 45 },
  });
  assert.equal(result.fields.barcode, '0000098765');
  assert.equal(result.fields.kitchenId, 'bar');
  assert.equal(result.fields.onlinePrice, 90);
  assert.equal(result.fields.currentStock, 35);
  assert.deepEqual(JSON.parse(String(result.fields.priceTable)), { 'default price': 75, Wholesale: 45, 'AC Table price': 80 });
  assert.equal(Object.hasOwn(result.fields, 'premisesPrices'), false);
  assert.ok(f.updates.every(update => update.path === path));
});

test('premises-only edits preserve the current default price and other prices', async () => {
  const f = fixture();
  const result = await updateOutletProduct(f.db, 'outlet', 'p1', 'user', assigned, { premisesPrices: { Wholesale: 0 } });
  assert.deepEqual(JSON.parse(String(result.fields.priceTable)), { 'default price': 50, Wholesale: 0 });
  assert.deepEqual(Object.keys(f.updates[0]!.fields), ['priceTable']);
});

test('invalid prices and missing service points fail without writing; assignments can be cleared', async () => {
  const f = fixture();
  for (const patch of [{ kitchenId: 'missing' }, { kitchenId: 'other/outlet' },
    { premisesPrices: { missing: 5 } }, { premisesPrices: { 'default price': 100 } },
    { premisesPrices: { Wholesale: -1 } }, { premisesPrices: { Wholesale: '10' } }]) {
    await assert.rejects(updateOutletProduct(f.db, 'outlet', 'p1', 'user', assigned, patch));
  }
  assert.deepEqual(f.updates, []);
  const result = await updateOutletProduct(f.db, 'outlet', 'p1', 'user', assigned, { kitchenId: '' });
  assert.equal(result.fields.kitchenId, '');
});

test('partial updates preserve stock or names changed since the form was opened', async () => {
  const f = fixture(); f.records.set(path, { ...f.records.get(path), currentStock: 80, name: 'Changed elsewhere' });
  const updated = await updateOutletProduct(f.db, 'outlet', 'p1', 'user', assigned, { discount: 15 });
  assert.equal(updated.fields.currentStock, 80); assert.equal(updated.fields.name, 'Changed elsewhere');
  assert.deepEqual(f.updates[0]!.fields, { discount: 15 });
});

test('products whose category was deleted can still update other fields but cannot move to a missing category', async () => {
  const f = fixture(); f.records.delete('OUTLET/outlet/CATEGORY/c1');
  const result = await updateOutletProduct(f.db, 'outlet', 'p1', 'user', assigned, { stockable: false, weighable: true });
  assert.deepEqual(f.updates[0]!.fields, { stockable: false, weighable: true }); assert.equal(result.fields.category, 'c1');
  await updateOutletProduct(f.db, 'outlet', 'p1', 'user', assigned, { category: 'c2' });
  assert.equal(f.records.get(path)!.category, 'c2');
  await assert.rejects(updateOutletProduct(f.db, 'outlet', 'p1', 'user', assigned, { category: 'c1' }),
    error => error instanceof ProductCreationError && error.status === 422 && !!error.errors.category);
});
