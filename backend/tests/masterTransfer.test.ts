import assert from 'node:assert/strict';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import type { Firestore } from 'firebase-admin/firestore';
import { issueTransferAuthorization, requireTransferAuthorization, transferOutletMasters } from '../src/masterTransfer.js';

const secret = 'isolated-master-transfer-test-key';
const requiredFields = ['name', 'category', 'taxIndex', 'unitId'];
const assignment = (profile: Record<string, unknown>) => Array.isArray(profile.outlets) ? profile.outlets as string[] : [];
function fixture() {
  const records = new Map<string, Record<string, unknown>>([
    ['USER_PROFILE/user', { active: true, outlets: ['source', 'destination'] }],
    ['OUTLET/source', { name: 'Source' }], ['OUTLET/destination', { name: 'Destination' }],
    ['OUTLET/source/CATEGORY/c1', { categoryNo: 1, name: 'Coffee', regionalName: 'Regional', dayType: 'All', privateSetting: 'Never copy' }],
    ['OUTLET/source/CATEGORY/c2', { categoryNo: 2, name: 'Food', regionalName: '' }],
    ['OUTLET/destination/CATEGORY/d1', { categoryNo: 9, name: 'Existing category', id: 'd1' }],
    ['OUTLET/source/PRODUCT/p1', { id: 'source-product', code: 55, name: 'Coffee product', regionalName: 'Regional product', shortName: 'CP',
      category: 'c1', price: 45, priceTable: '{"default price":45,"other price":99}', mrpPrice: 60, costPrice: 20, taxIndex: 1, unitId: 2,
      hsnCode: '123', barcode: 'BAR-1', discount: 25, stockable: true, weighable: true, currentStock: 999, purchaseHistory: 'Never copy', privateValue: 'Never copy' }],
    ['OUTLET/destination/PRODUCT/old', { id: 'old', code: 20, name: 'Other product', barcode: 'OTHER', currentStock: 77, discount: 7, stockable: true, weighable: false }],
    ['MASTERS/masters/TAX_MASTER/tax', { type: 0, index: 1, percent: 5 }],
  ]);
  const reads: string[] = [], writes: string[] = [];
  let failCommit = false, retry = false;
  const ref = (path: string, kind: 'doc' | 'collection'): any => ({ path, kind, id: path.split('/').at(-1),
    doc: (id: string) => ref(`${path}/${id}`, 'doc'), collection: (id: string) => ref(`${path}/${id}`, 'collection') });
  const snapshot = (path: string) => ({ id: path.split('/').at(-1), exists: records.has(path), data: () => structuredClone(records.get(path)) });
  let queue = Promise.resolve();
  const db = { collection: (name: string) => ref(name, 'collection'), runTransaction: (callback: any) => {
    const operation = queue.then(async () => {
      let pending: { path: string; data: Record<string, unknown> }[] = [];
      const transaction = {
        get: async (reference: any) => {
          assert.equal(pending.length, 0, 'All reads precede transaction writes'); reads.push(reference.path);
          return reference.kind === 'doc' ? snapshot(reference.path) : { docs: [...records.keys()]
            .filter(path => path.startsWith(reference.path + '/') && !path.slice(reference.path.length + 1).includes('/')).map(snapshot) };
        },
        create: (reference: any, data: Record<string, unknown>) => { pending.push({ path: reference.path, data }); },
      };
      let result = await callback(transaction);
      if (retry) {
        retry = false; pending = [];
        records.set('OUTLET/destination/CATEGORY/concurrent', { name: 'Concurrent category', categoryNo: 100 });
        records.set('OUTLET/destination/PRODUCT/concurrent', { name: 'Concurrent unrelated product', code: 100, currentStock: 12 });
        result = await callback(transaction);
      }
      if (failCommit) throw new Error('SIMULATED COMMIT FAILURE');
      for (const write of pending) assert.ok(!records.has(write.path), 'No overwrite is permitted');
      for (const write of pending) { writes.push(write.path); records.set(write.path, structuredClone(write.data)); }
      return result;
    });
    queue = operation.then(() => undefined, () => undefined); return operation;
  } } as unknown as Firestore;
  const grant = issueTransferAuthorization(secret, 'user', 'source', 'destination');
  const productRequest = { destinationOutletId: 'destination', mode: 'products', categoryIds: [] as string[],
    products: [{ sourceProductId: 'p1', fields: [...requiredFields] }], categoryMappings: { c1: 'd1' } as Record<string, string> };
  const categories = { destinationOutletId: 'destination', mode: 'categories', categoryIds: ['c1', 'c2'], products: [], categoryMappings: {} };
  return { records, reads, writes, db, grant, productRequest, categories,
    transfer: (raw: unknown, authorization = grant, user: string | null = 'user') => transferOutletMasters(db, 'source', user, assignment, secret, authorization, raw),
    fail: () => { failCommit = true; }, retry: () => { retry = true; } };
}
const newProducts = (f: ReturnType<typeof fixture>) => f.writes.filter(path => path.includes('/PRODUCT/')).map(path => f.records.get(path)!);

test('writes only selected category masters with new destination IDs and preserves source data', async () => {
  const f = fixture(); const before = structuredClone(f.records);
  const result = await f.transfer({ ...f.categories, categoryIds: ['c1'] });
  assert.equal(result.created, 1); assert.equal(f.writes.length, 1);
  const saved = f.records.get(f.writes[0]!)!;
  assert.deepEqual(Object.keys(saved).sort(), ['categoryNo', 'dayType', 'id', 'name', 'onlineSynced', 'regionalName', 'selected'].sort());
  assert.notEqual(saved.id, 'c1'); assert.equal(saved.name, 'Coffee');
  for (const [path, data] of before) assert.deepEqual(f.records.get(path), data);
});
test('new products copy only explicitly selected fields, allocate destination codes, and always start with zero stock', async () => {
  const f = fixture(); const before = structuredClone(f.records);
  const result = await f.transfer(f.productRequest); const product = newProducts(f)[0]!;
  assert.equal(result.created, 1); assert.equal(product.code, 21); assert.equal(product.category, 'd1');
  assert.equal(product.currentStock, 0); assert.equal(product.discount, 0); assert.equal(product.price, 0);
  assert.equal(product.stockable, false); assert.equal(product.weighable, false); assert.equal(product.barcode, '');
  assert.equal(product.regionalName, ''); assert.ok(!('purchaseHistory' in product)); assert.ok(!('privateValue' in product));
  assert.ok(f.writes.every(path => path.startsWith('OUTLET/destination/PRODUCT/')));
  for (const [path, data] of before) assert.deepEqual(f.records.get(path), data);
});
test('supports independent configuration flags, explicit discount and barcode, and default-price-only serialization', async () => {
  for (const selected of [['stockable'], ['weighable'], ['stockable', 'weighable', 'discount', 'barcode', 'price', 'hsnCode']]) {
    const f = fixture(); f.productRequest.products[0]!.fields.push(...selected); await f.transfer(f.productRequest);
    const product = newProducts(f)[0]!;
    assert.equal(product.stockable, selected.includes('stockable')); assert.equal(product.weighable, selected.includes('weighable'));
    assert.equal(product.currentStock, 0); assert.equal(product.discount, selected.includes('discount') ? 25 : 0);
    if (selected.includes('price')) assert.deepEqual(JSON.parse(String(product.priceTable)), { 'default price': 45 });
    if (selected.includes('barcode')) assert.equal(product.barcode, 'BAR-1');
  }
});
test('transfers required categories and maps products to the newly created destination IDs', async () => {
  const f = fixture(); f.productRequest.categoryIds = ['c1']; f.productRequest.categoryMappings = {};
  const result = await f.transfer(f.productRequest); assert.equal(result.created, 2);
  const category = result.items.find(item => item.type === 'category')!;
  assert.equal(newProducts(f)[0]!.category, category.destinationId); assert.notEqual(category.destinationId, 'c1');
});
test('explicit category mapping reuses an existing category without modifying it', async () => {
  const f = fixture(); const before = structuredClone(f.records);
  const result = await f.transfer({ ...f.categories, categoryIds: ['c1'], categoryMappings: { c1: 'd1' } });
  assert.equal(result.items[0]!.status, 'mapped'); assert.deepEqual(f.records, before); assert.deepEqual(f.writes, []);
});
test('category name conflicts and dependent products are skipped safely', async () => {
  const f = fixture(); f.records.set('OUTLET/destination/CATEGORY/conflict', { name: 'Coffee', categoryNo: 100 });
  const before = structuredClone(f.records); f.productRequest.categoryIds = ['c1']; f.productRequest.categoryMappings = {};
  const result = await f.transfer(f.productRequest); assert.equal(result.skipped, 2); assert.deepEqual(f.records, before);
});
test('product name and barcode conflicts are review warnings, never identity matches or overwrite permission', async () => {
  for (const change of [{ name: 'Coffee product' }, { barcode: 'BAR-1' }]) {
    const f = fixture(); Object.assign(f.records.get('OUTLET/destination/PRODUCT/old')!, change);
    const before = structuredClone(f.records); const result = await f.transfer(f.productRequest);
    assert.equal(result.skipped, 1); assert.deepEqual(f.records, before); assert.equal(f.records.get('OUTLET/destination/PRODUCT/old')!.currentStock, 77);
  }
});
test('repeated requests and concurrent retries do not duplicate categories or products', async () => {
  const f = fixture(); f.productRequest.categoryIds = ['c1']; f.productRequest.categoryMappings = {};
  const [first, second] = await Promise.all([f.transfer(f.productRequest), f.transfer(f.productRequest)]);
  assert.equal(first.created, 2); assert.equal(second.created, 0); assert.equal(second.unchanged, 2); assert.equal(f.writes.length, 2);
  const productPath = f.writes.find(path => path.includes('/PRODUCT/'))!; f.records.get(productPath)!.currentStock = 88;
  const third = await f.transfer(f.productRequest); assert.equal(third.unchanged, 2); assert.equal(f.records.get(productPath)!.currentStock, 88);
});
test('transaction retries recalculate codes from concurrent destination changes', async () => {
  const f = fixture(); f.retry(); await f.transfer(f.productRequest); assert.equal(newProducts(f)[0]!.code, 101);
});
test('failed commits do not write records or return false item success', async () => {
  const f = fixture(); const before = structuredClone(f.records); f.fail();
  await assert.rejects(f.transfer(f.productRequest)); assert.deepEqual(f.records, before); assert.deepEqual(f.writes, []);
});
test('reports item-level partial success for a selected record that was deleted', async () => {
  const f = fixture(); const result = await f.transfer({ ...f.categories, categoryIds: ['c1', 'deleted'] });
  assert.equal(result.created, 1); assert.equal(result.skipped, 1); assert.equal(f.writes.length, 1);
});
test('rejects field/value injection, stock, history, source codes and malformed selections before database access', async () => {
  for (const field of ['currentStock', 'code', 'priceTable', 'history', 'id', 'Price 1']) {
    const f = fixture(); f.productRequest.products[0]!.fields.push(field);
    await assert.rejects(f.transfer(f.productRequest), { status: 422 }); assert.deepEqual(f.reads, []);
  }
  const f = fixture(); await assert.rejects(f.transfer({ ...f.productRequest, arbitraryField: 1 }), { status: 422 });
  await assert.rejects(f.transfer({ ...f.productRequest, products: [{ ...f.productRequest.products[0], price: 999 }] }), { status: 422 });
  await assert.rejects(f.transfer({ ...f.productRequest, destinationOutletId: 'source' }), { status: 422 });
  assert.deepEqual(f.writes, []);
});
test('unresolved/foreign category mappings, missing source fields and invalid tax/unit references cannot create products', async () => {
  const f = fixture(); await assert.rejects(f.transfer({ ...f.productRequest, categoryMappings: { c1: 'foreign-category' } }), { status: 422 });
  const missing = fixture(); missing.productRequest.categoryMappings = {}; assert.equal((await missing.transfer(missing.productRequest)).skipped, 1);
  for (const change of [{ taxIndex: 999 }, { unitId: 999 }, { name: undefined }]) {
    const g = fixture(); Object.assign(g.records.get('OUTLET/source/PRODUCT/p1')!, change);
    assert.equal((await g.transfer(g.productRequest)).skipped, 1); assert.deepEqual(g.writes, []);
  }
});
test('both outlet assignments and current active account are rechecked inside the transaction', async () => {
  for (const profile of [{ active: false, outlets: ['source', 'destination'] }, { active: true, outlets: ['source'] }, { active: true, outlets: ['destination'] }]) {
    const f = fixture(); f.records.set('USER_PROFILE/user', profile);
    await assert.rejects(f.transfer(f.productRequest), { status: 403 }); assert.deepEqual(f.writes, []);
  }
});
test('grants are short-lived and bound to the user, source and destination; normal session tokens cannot authorize transfers', async t => {
  const f = fixture(); const normalToken = jwt.sign({ profileDocId: 'user' }, secret);
  for (const grant of ['', normalToken, issueTransferAuthorization(secret, 'other', 'source', 'destination'),
    issueTransferAuthorization(secret, 'user', 'other', 'destination'), issueTransferAuthorization(secret, 'user', 'source', 'other')]) {
    await assert.rejects(f.transfer(f.productRequest, grant), { status: 403 });
  }
  await assert.rejects(f.transfer(f.productRequest, f.grant, null), { status: 401 });
  assert.deepEqual(f.reads, []);
  const payload = jwt.decode(f.grant) as jwt.JwtPayload; assert.equal(payload.exp! - payload.iat!, 300); assert.ok(!('profileDocId' in payload));
  t.mock.method(Date, 'now', () => (payload.exp! + 1) * 1000);
  assert.throws(() => requireTransferAuthorization(secret, f.grant, 'user', 'source', 'destination'), { status: 403 });
});
test('transfer grants fail closed if the existing server signing key is missing or too short', () => {
  for (const key of ['', 'web-pos-secret-key-2026']) {
    assert.throws(() => issueTransferAuthorization(key, 'user', 'source', 'destination'), { status: 503 });
    assert.throws(() => requireTransferAuthorization(key, '', 'user', 'source', 'destination'), { status: 503 });
  }
});

test('category number collisions allocate sequentially after destination maximum without changing either source or existing destination records', async () => {
  const f = fixture();
  for (let i = 1; i <= 10; i++) f.records.set(`OUTLET/destination/CATEGORY/existing${i}`, { name: `Existing ${i}`, categoryNo: i });
  const before = structuredClone(f.records);
  const result = await f.transfer(f.categories);
  assert.equal(result.created, 2); assert.equal(result.skipped, 0);
  assert.deepEqual(result.items.map(item => item.destinationNumber), [11, 12]);
  assert.deepEqual(f.writes.map(path => f.records.get(path)!.categoryNo), [11, 12]);
  for (const [path, fields] of before) assert.deepEqual(f.records.get(path), fields);
  assert.equal((await f.transfer(f.categories)).created, 0); assert.equal(f.writes.length, 2);
});
test('gaps and custom category numbers use maximum plus one', async () => {
  const f = fixture(); f.records.set('OUTLET/destination/CATEGORY/custom', { name: 'Custom', categoryNo: 300 });
  await f.transfer(f.categories);
  assert.deepEqual(f.writes.map(path => f.records.get(path)!.categoryNo), [301, 302]);
});
test('colliding source product codes do not prevent sequential copies', async () => {
  const f = fixture(); f.records.get('OUTLET/source/PRODUCT/p1')!.code = 20;
  f.records.set('OUTLET/source/PRODUCT/p2', { ...f.records.get('OUTLET/source/PRODUCT/p1')!, name: 'Second product', barcode: 'OTHER-SOURCE' });
  f.productRequest.products.push({ sourceProductId: 'p2', fields: [...requiredFields] });
  const result = await f.transfer(f.productRequest);
  assert.equal(result.created, 2); assert.deepEqual(newProducts(f).map(product => product.code), [21, 22]);
});

test('transaction retries recalculate sequential category numbers from concurrent changes', async () => {
  const f = fixture(); f.retry(); const result = await f.transfer(f.categories);
  assert.deepEqual(result.items.map(item => item.destinationNumber), [101, 102]);
});
