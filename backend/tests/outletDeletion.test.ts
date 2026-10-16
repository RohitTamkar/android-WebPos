import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Firestore } from 'firebase-admin/firestore';
import { deleteOutletRecord, OutletDeletionError } from '../src/outletDeletion.js';
class Ref {
  constructor(public path: string) {}
  doc(id: string) { return new Ref(`${this.path}/${id}`); }
  collection(name: string) { return new Ref(`${this.path}/${name}`); }
}
function fixture() {
  const records = new Map<string, Record<string, unknown>>([
    ['USER_PROFILE/user', { active: true, outlets: ['outlet'] }],
    ['OUTLET/outlet/PRODUCT/product', { id: 'different-stored-id', code: 10, category: 'category' }],
    ['OUTLET/outlet/PRODUCT/other', { id: 'other', code: 11, category: 'category' }],
    ['OUTLET/outlet/CATEGORY/category', { id: 'category', categoryNo: 2 }],
    ['OUTLET/foreign/PRODUCT/product', { code: 50 }],
    ['OUTLET/foreign/CATEGORY/category', { categoryNo: 50 }],
    ['OUTLET/outlet/BILL/bill', { product: 'product' }],
    ['OUTLET/outlet/PRODUCT/product/EXISTING_CHILD/child', { value: 'preserved' }],
  ]);
  const versions = new Map<string, number>();
  const reads: string[] = [], deletes: string[] = [];
  let failBeforeCommit = false, failAfterCommit = false;
  const db = {
    collection: (path: string) => new Ref(path),
    async runTransaction(callback: (transaction: unknown) => Promise<unknown>) {
      for (;;) {
        const pending: string[] = [], seen = new Map<string, number>();
        const result = await callback({
          get: async (ref: Ref) => {
            assert.equal(pending.length, 0, 'reads precede deletion'); reads.push(ref.path);
            seen.set(ref.path, versions.get(ref.path) ?? 0);
            const fields = records.get(ref.path);
            await Promise.resolve();
            return { exists: fields !== undefined, data: () => fields };
          },
          delete: (ref: Ref) => { pending.push(ref.path); },
        });
        if ([...seen].some(([path, version]) => (versions.get(path) ?? 0) !== version)) continue;
        if (failBeforeCommit) { failBeforeCommit = false; throw new Error('database failure'); }
        for (const path of pending) { records.delete(path); versions.set(path, (versions.get(path) ?? 0) + 1); deletes.push(path); }
        if (failAfterCommit) { failAfterCommit = false; throw new Error('lost response'); }
        return result;
      }
    },
  };
  return { db: db as unknown as Firestore, records, reads, deletes,
    failBefore: () => { failBeforeCommit = true; }, failAfter: () => { failAfterCommit = true; } };
}
const assigned = (profile: Record<string, unknown>) => profile.outlets as string[];

test('product and category deletion remove only the selected document by actual document ID', async () => {
  for (const [collection, id] of [['PRODUCT', 'product'], ['CATEGORY', 'category']] as const) {
    const f = fixture(); const before = structuredClone(f.records);
    const result = await deleteOutletRecord(f.db, 'outlet', collection, id, 'user', assigned);
    const path = `OUTLET/outlet/${collection}/${id}`;
    assert.deepEqual(result, { id, deleted: true });
    assert.equal(f.records.has(path), false); assert.deepEqual(f.deletes, [path]);
    before.delete(path); assert.deepEqual(f.records, before, 'all other records, fields, children and references remain unchanged');
  }
});

test('missing session, inactive/missing user and unauthorized outlet never read or delete masters', async () => {
  const f = fixture(); const before = structuredClone(f.records);
  await assert.rejects(deleteOutletRecord(f.db, 'outlet', 'PRODUCT', 'product', null, assigned), error => error instanceof OutletDeletionError && error.status === 401);
  await assert.rejects(deleteOutletRecord(f.db, 'foreign', 'PRODUCT', 'product', 'user', assigned), error => error instanceof OutletDeletionError && error.status === 403);
  await assert.rejects(deleteOutletRecord(f.db, 'outlet', 'CATEGORY', 'category', 'missing', assigned), error => error instanceof OutletDeletionError && error.status === 403);
  assert.deepEqual(f.records, before);
  f.records.set('USER_PROFILE/user', { active: false, outlets: ['outlet'] });
  await assert.rejects(deleteOutletRecord(f.db, 'outlet', 'PRODUCT', 'product', 'user', assigned), error => error instanceof OutletDeletionError && error.status === 403);
  assert.ok(f.reads.every(path => path.startsWith('USER_PROFILE/'))); assert.deepEqual(f.deletes, []);
});

test('invalid document/outlet paths and arbitrary collections are rejected before reads', async () => {
  const f = fixture();
  for (const id of ['', 'a/b', '.', '..']) {
    await assert.rejects(deleteOutletRecord(f.db, 'outlet', 'PRODUCT', id, 'user', assigned), error => error instanceof OutletDeletionError && error.status === 400);
    await assert.rejects(deleteOutletRecord(f.db, id, 'CATEGORY', 'category', 'user', assigned), error => error instanceof OutletDeletionError && error.status === 400);
  }
  await assert.rejects(deleteOutletRecord(f.db, 'outlet', 'BILL' as 'PRODUCT', 'bill', 'user', assigned), error => error instanceof OutletDeletionError && error.status === 400);
  assert.deepEqual(f.reads, []); assert.deepEqual(f.deletes, []);
});

test('missing and already deleted records succeed idempotently without any other writes', async () => {
  const f = fixture();
  assert.deepEqual(await deleteOutletRecord(f.db, 'outlet', 'PRODUCT', 'absent', 'user', assigned), { id: 'absent', deleted: false });
  await deleteOutletRecord(f.db, 'outlet', 'PRODUCT', 'product', 'user', assigned);
  assert.deepEqual(await deleteOutletRecord(f.db, 'outlet', 'PRODUCT', 'product', 'user', assigned), { id: 'product', deleted: false });
  assert.deepEqual(f.deletes, ['OUTLET/outlet/PRODUCT/product']);
});

test('failed deletion preserves the row; lost-response retry reconciles the same record', async () => {
  const f = fixture(); const before = structuredClone(f.records);
  f.failBefore(); await assert.rejects(deleteOutletRecord(f.db, 'outlet', 'PRODUCT', 'product', 'user', assigned), /database failure/);
  assert.deepEqual(f.records, before);
  f.failAfter(); await assert.rejects(deleteOutletRecord(f.db, 'outlet', 'PRODUCT', 'product', 'user', assigned), /lost response/);
  assert.equal(f.records.has('OUTLET/outlet/PRODUCT/product'), false);
  await deleteOutletRecord(f.db, 'outlet', 'PRODUCT', 'product', 'user', assigned);
  assert.deepEqual(f.deletes, ['OUTLET/outlet/PRODUCT/product']);
});

test('concurrent deletion requests reconcile without deleting any other document', async () => {
  const f = fixture(); const before = structuredClone(f.records);
  const results = await Promise.all([
    deleteOutletRecord(f.db, 'outlet', 'CATEGORY', 'category', 'user', assigned),
    deleteOutletRecord(f.db, 'outlet', 'CATEGORY', 'category', 'user', assigned),
  ]);
  assert.equal(results.filter(result => result.deleted).length, 1);
  assert.deepEqual(f.deletes, ['OUTLET/outlet/CATEGORY/category']);
  before.delete('OUTLET/outlet/CATEGORY/category'); assert.deepEqual(f.records, before);
});
