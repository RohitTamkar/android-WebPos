import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Bucket } from '@google-cloud/storage';
import type { Firestore } from 'firebase-admin/firestore';
import { ProductCreationError, requireProductOutlet } from '../src/productCreation.js';
import { copyMasterImage, copyMasterImageFromPath, isMasterImagePath, productImageStoragePath, readMasterImage, removeMasterImage, uploadMasterImage } from '../src/imageStorage.js';

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);

class FakeDocument {
  data: Record<string, unknown>;
  updates: Record<string, unknown>[] = [];
  failUpdate = false;
  constructor(initial: Record<string, unknown>) { this.data = { ...initial }; }
  async get() {
    return { exists: true, get: (key: string) => this.data[key], data: () => this.data };
  }
  async update(patch: Record<string, unknown>) {
    this.updates.push(patch);
    if (this.failUpdate) throw new Error('simulated Firestore update failure');
    for (const [key, value] of Object.entries(patch)) {
      if (key === 'imagePath' && typeof value !== 'string') delete this.data[key];
      else this.data[key] = value;
    }
  }
}

function fakeDatabase(documents: Map<string, FakeDocument>) {
  return { collection: (root: string) => ({ doc: (outlet: string) => ({ collection: (collection: string) => ({
    doc: (id: string) => {
      const key = `${root}/${outlet}/${collection}/${id}`;
      let document = documents.get(key);
      if (!document) { document = new FakeDocument({}); documents.set(key, document); }
      return document;
    }
  }) }) }) } as unknown as Firestore;
}

function fakeBucket(behavior: { failSave?: boolean; storedBytes?: Buffer; contentType?: string; failRead?: boolean; collision?: boolean } = {}) {
  const objects = new Map<string, Buffer>();
  const saves: { path: string; generation: number | undefined }[] = [];
  const bucket = { file: (path: string) => ({
    save: async (bytes: Buffer, options?: { preconditionOpts?: { ifGenerationMatch?: number } }) => {
      saves.push({ path, generation: options?.preconditionOpts?.ifGenerationMatch });
      if (behavior.failSave) throw new Error('simulated upload failure');
      if (behavior.collision) objects.set(path, Buffer.from('another product image'));
      if (options?.preconditionOpts?.ifGenerationMatch === 0 && objects.has(path)) throw { code: 412 };
      objects.set(path, Buffer.from(behavior.storedBytes ?? bytes));
    },
    getSignedUrl: async () => {
      if (behavior.failRead) throw new Error('simulated read failure');
      const bytes = objects.get(path); if (!bytes) throw new Error('missing');
      return [`data:application/octet-stream;base64,${bytes.toString('base64')}`];
    },
    getMetadata: async () => {
      const bytes = objects.get(path); if (!bytes) throw new Error('missing');
      return [{ size: String(bytes.length), contentType: behavior.contentType ?? 'image/png' }];
    },
    delete: async () => { objects.delete(path); },
  }) } as unknown as Bucket;
  return { bucket, objects, saves };
}

test('upload stores verified bytes in product_images and only the filename in image', async () => {
  const documents = new Map([['OUTLET/outlet/PRODUCT/product', new FakeDocument({ name: 'Tea', price: 12, imagePath: 'old/path' })]]);
  const db = fakeDatabase(documents); const { bucket, objects } = fakeBucket();
  const result = await uploadMasterImage(db, bucket, 'products', 'outlet', 'product', png, 'image/png');
  const document = documents.get('OUTLET/outlet/PRODUCT/product')!;
  assert.match(result.image!, /^[a-f0-9-]+\.png$/);
  assert.deepEqual(Object.keys(document.updates[0]!).sort(), ['image', 'imagePath']);
  assert.equal(document.data.image, result.image); assert.equal(document.data.imagePath, undefined);
  assert.equal(document.data.name, 'Tea'); assert.equal(document.data.price, 12);
  assert.equal(objects.get(`product_images/${result.image!}`)?.equals(png), true);
});

test('category images use the existing category document ID and collection', async () => {
  const documents = new Map([['OUTLET/outlet/CATEGORY/category', new FakeDocument({ name: 'Drinks', categoryNo: 3 })]]);
  const db = fakeDatabase(documents); const { bucket } = fakeBucket();
  const result = await uploadMasterImage(db, bucket, 'categories', 'outlet', 'category', png, 'image/png');
  assert.match(result.imagePath!, /^sensible_images\/OUTLET\/outlet\/CATEGORY_IMAGES\/category\//);
  assert.deepEqual(documents.get('OUTLET/outlet/CATEGORY/category')!.updates, [{ imagePath: result.imagePath }]);
});

test('unsupported bytes are rejected before any Storage write', async () => {
  const db = fakeDatabase(new Map([['OUTLET/outlet/PRODUCT/product', new FakeDocument({ name: 'Tea' })]]));
  const { bucket, objects } = fakeBucket();
  await assert.rejects(uploadMasterImage(db, bucket, 'products', 'outlet', 'product', Buffer.from('not image'), 'image/png'), /valid JPEG, PNG, or WebP/);
  assert.equal(objects.size, 0);
});

test('declared type mismatch and oversized files are rejected', async () => {
  const db = fakeDatabase(new Map([['OUTLET/outlet/PRODUCT/product', new FakeDocument({ name: 'Tea' })]]));
  const { bucket, objects } = fakeBucket();
  await assert.rejects(uploadMasterImage(db, bucket, 'products', 'outlet', 'product', png, 'image/jpeg'), /does not match/);
  await assert.rejects(uploadMasterImage(db, bucket, 'products', 'outlet', 'product', Buffer.alloc(30 * 1024 + 1), 'image/png'), /30 KB or smaller/);
  assert.equal(objects.size, 0);
});

test('image routes reuse active-profile and assigned-outlet authorization rules', () => {
  assert.throws(() => requireProductOutlet('profile', 'other-outlet', { active: true, outletId: 'outlet' }, profile => [String(profile.outletId)]), ProductCreationError);
  assert.throws(() => requireProductOutlet('profile', 'outlet', { active: false, outletId: 'outlet' }, profile => [String(profile.outletId)]), ProductCreationError);
});

test('uncertain Firestore failure keeps the uploaded object and does not alter old fields', async () => {
  const document = new FakeDocument({ name: 'Tea', imagePath: 'old/path' }); document.failUpdate = true;
  const db = fakeDatabase(new Map([['OUTLET/outlet/PRODUCT/product', document]]));
  const { bucket, objects } = fakeBucket();
  await assert.rejects(uploadMasterImage(db, bucket, 'products', 'outlet', 'product', png, 'image/png'), /could not be confirmed/);
  assert.equal(document.data.imagePath, 'old/path'); assert.equal(document.data.name, 'Tea');
  assert.equal(objects.size, 1);
});

test('read and remove operate on the saved image reference only', async () => {
  const document = new FakeDocument({ name: 'Tea', imagePath: 'sensible_images/OUTLET/outlet/PRODUCT_IMAGES/product/abc123.png' });
  const db = fakeDatabase(new Map([['OUTLET/outlet/PRODUCT/product', document]]));
  const { bucket, objects } = fakeBucket();
  objects.set(String(document.data.imagePath), png);
  const image = await readMasterImage(db, bucket, 'products', 'outlet', 'product');
  assert.deepEqual(image.bytes, png); assert.equal(image.contentType, 'image/png');
  await removeMasterImage(db, 'products', 'outlet', 'product');
  assert.deepEqual(Object.keys(document.updates[0]!), ['imagePath']);
  assert.equal(document.data.name, 'Tea'); assert.equal(document.data.imagePath, undefined);
  assert.equal(objects.has('sensible_images/OUTLET/outlet/PRODUCT_IMAGES/product/abc123.png'), true);
});

test('existing records without imagePath remain valid and read as image-free', async () => {
  const db = fakeDatabase(new Map([['OUTLET/outlet/CATEGORY/category', new FakeDocument({ name: 'Drinks' })]]));
  const { bucket } = fakeBucket();
  await assert.rejects(readMasterImage(db, bucket, 'categories', 'outlet', 'category'), /No saved image/);
  await removeMasterImage(db, 'categories', 'outlet', 'category');
});

test('transfer copies legacy source image bytes into product_images', async () => {
  const sourcePath = 'sensible_images/OUTLET/source/PRODUCT_IMAGES/product/abc123.png';
  const documents = new Map([['OUTLET/source/PRODUCT/product', new FakeDocument({ imagePath: sourcePath })]]);
  const db = fakeDatabase(documents); const { bucket, objects } = fakeBucket(); objects.set(sourcePath, png);
  const targetPath = await copyMasterImage(db, bucket, 'products', 'source', 'product', 'destination', 'target');
  assert.match(targetPath, /^product_images\/[a-f0-9]{64}\.png$/);
  assert.equal(objects.get(targetPath)?.equals(png), true);
});

test('retry reuses a matching destination object and rejects a conflicting object without overwriting it', async () => {
  const sourcePath = 'sensible_images/OUTLET/source/PRODUCT_IMAGES/product/abc123.png';
  const { bucket, objects } = fakeBucket(); objects.set(sourcePath, png);
  const first = await copyMasterImageFromPath(bucket, 'products', 'source', 'product', sourcePath, 'destination', 'target');
  const second = await copyMasterImageFromPath(bucket, 'products', 'source', 'product', sourcePath, 'destination', 'target');
  assert.equal(second.imagePath, first.imagePath); assert.equal(objects.get(first.imagePath)?.equals(png), true);
  const conflict = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 9]); objects.set(first.imagePath, conflict);
  await assert.rejects(copyMasterImageFromPath(bucket, 'products', 'source', 'product', sourcePath, 'destination', 'target'), /conflicting destination image/);
  assert.equal(objects.get(first.imagePath)?.equals(conflict), true);
});

test('malformed source references are rejected before Storage reads or writes', async () => {
  const { bucket, objects } = fakeBucket();
  await assert.rejects(copyMasterImageFromPath(bucket, 'categories', 'source', 'category',
    'https://storage.googleapis.com/bucket/untrusted.png', 'destination', 'target'), /source image reference is invalid/);
  assert.equal(objects.size, 0);
});

test('upload verification failures preserve every existing field and Storage object', async () => {
  for (const behavior of [
    { storedBytes: Buffer.from('not an image') },
    { storedBytes: Buffer.from([...png.subarray(0, -1), 99]) },
    { contentType: 'image/jpeg' },
    { failRead: true },
  ]) {
    const oldPath = 'sensible_images/OUTLET/outlet/PRODUCT_IMAGES/product/abc123.png';
    const initial = { name: 'Tea', image: '1000014014.png', imagePath: oldPath, price: 12, currentStock: 7, category: 'c1' };
    const document = new FakeDocument(initial);
    const db = fakeDatabase(new Map([['OUTLET/outlet/PRODUCT/product', document]]));
    const { bucket, objects } = fakeBucket(behavior); objects.set(oldPath, png);
    await assert.rejects(uploadMasterImage(db, bucket, 'products', 'outlet', 'product', png, 'image/png'), /could not be verified/);
    assert.deepEqual(document.data, initial); assert.deepEqual(document.updates, []);
    assert.deepEqual(objects.get(oldPath), png);
    assert.equal(objects.size, 2, 'Unreferenced uploads are retained; no Storage objects are deleted');
  }
});

test('a filename collision cannot overwrite an existing object or update Firestore', async () => {
  const document = new FakeDocument({ image: null, name: 'Tea' });
  const db = fakeDatabase(new Map([['OUTLET/outlet/PRODUCT/product', document]]));
  const { bucket, objects, saves } = fakeBucket({ collision: true });
  await assert.rejects(uploadMasterImage(db, bucket, 'products', 'outlet', 'product', png, 'image/png'), /could not accept the upload/);
  assert.equal(saves[0]!.generation, 0);
  assert.deepEqual(objects.get(saves[0]!.path), Buffer.from('another product image'));
  assert.deepEqual(document.data, { image: null, name: 'Tea' }); assert.deepEqual(document.updates, []);
});

test('a failed upload can be retried without changing the old reference or unrelated product fields', async () => {
  const initial = { name: 'Tea', image: null, imagePath: 'old/path', price: 12, currentStock: 7 };
  const document = new FakeDocument(initial);
  const db = fakeDatabase(new Map([['OUTLET/outlet/PRODUCT/product', document]]));
  const behavior = { failSave: true }; const { bucket, objects, saves } = fakeBucket(behavior);
  await assert.rejects(uploadMasterImage(db, bucket, 'products', 'outlet', 'product', png, 'image/png'), /could not accept the upload/);
  assert.deepEqual(document.data, initial); assert.equal(objects.size, 0);
  behavior.failSave = false;
  const saved = await uploadMasterImage(db, bucket, 'products', 'outlet', 'product', png, 'image/png');
  assert.notEqual(saves[0]!.path, `product_images/${saved.image!}`);
  assert.deepEqual(document.data, { name: 'Tea', image: saved.image, price: 12, currentStock: 7 });
  assert.deepEqual((await readMasterImage(db, bucket, 'products', 'outlet', 'product')).bytes, png);
});

test('replacement retains old image bytes and uses a fresh immutable path on every upload', async () => {
  const document = new FakeDocument({ name: 'Tea', image: '1000014014.png' });
  const db = fakeDatabase(new Map([['OUTLET/outlet/PRODUCT/product', document]]));
  const { bucket, objects, saves } = fakeBucket();
  const first = await uploadMasterImage(db, bucket, 'products', 'outlet', 'product', png, 'image/png');
  const replacement = Buffer.from([...png, 99]);
  const second = await uploadMasterImage(db, bucket, 'products', 'outlet', 'product', replacement, 'image/png');
  assert.notEqual(first.image!, second.image!);
  assert.deepEqual(objects.get(`product_images/${first.image!}`), png); assert.deepEqual(objects.get(`product_images/${second.image!}`), replacement);
  assert.equal(document.data.image, second.image); assert.equal(document.data.imagePath, undefined);
  assert.ok(saves.every(save => save.generation === 0));
  assert.deepEqual((await readMasterImage(db, bucket, 'products', 'outlet', 'product')).bytes, replacement);
});

test('image references must match the complete outlet, record and collection prefix', async () => {
  const prefix = 'sensible_images/OUTLET/outlet/PRODUCT_IMAGES/product/';
  for (const path of [
    `${'x'.repeat(prefix.length)}abc123.png`,
    'sensible_images/OUTLET/others/PRODUCT_IMAGES/product/abc123.png',
    'sensible_images/OUTLET/outlet/PRODUCT_IMAGES/another/abc123.png',
    'sensible_images/OUTLET/outlet/CATEGORY_IMAGES/product/abc123.png',
    `${prefix}../abc123.png`,
  ]) {
    assert.equal(isMasterImagePath(path, 'products', 'outlet', 'product'), false);
    const document = new FakeDocument({ imagePath: path });
    const db = fakeDatabase(new Map([['OUTLET/outlet/PRODUCT/product', document]]));
    const { bucket, objects } = fakeBucket(); objects.set(path, png);
    await assert.rejects(readMasterImage(db, bucket, 'products', 'outlet', 'product'), /No saved image/);
    await assert.rejects(copyMasterImageFromPath(bucket, 'products', 'outlet', 'product', path, 'destination', 'target'), /source image reference is invalid/);
    assert.equal(objects.size, 1);
  }
});

test('products without either image reference need no document writes', async () => {
  const document = new FakeDocument({ name: 'Tea', price: 12 });
  const db = fakeDatabase(new Map([['OUTLET/outlet/PRODUCT/product', document]]));
  const { bucket, objects } = fakeBucket();
  await assert.rejects(readMasterImage(db, bucket, 'products', 'outlet', 'product'), /No saved image/);
  await removeMasterImage(db, 'products', 'outlet', 'product');
  assert.deepEqual(document.data, { name: 'Tea', price: 12 });
  assert.deepEqual(document.updates, []); assert.equal(objects.size, 0);
});

test('an existing product filename resolves in the configured bucket without modifying the document', async () => {
  const document = new FakeDocument({ name: 'Tea', image: '1000014014.png', price: 12 });
  const db = fakeDatabase(new Map([['OUTLET/outlet/PRODUCT/product', document]]));
  const { bucket, objects } = fakeBucket(); objects.set('product_images/1000014014.png', png);
  const result = await readMasterImage(db, bucket, 'products', 'outlet', 'product');
  assert.deepEqual(result.bytes, png); assert.equal(result.imagePath, 'product_images/1000014014.png');
  assert.deepEqual(document.updates, []);
  const copied = await copyMasterImage(db, bucket, 'products', 'outlet', 'product', 'destination', 'target');
  assert.match(copied, /^product_images\/[a-f0-9]{64}\.png$/);
  assert.deepEqual(objects.get(copied), png);
});

test('image takes precedence and missing or invalid active images never fall back to stale imagePath', async () => {
  const path = 'sensible_images/OUTLET/outlet/PRODUCT_IMAGES/product/abc123.png';
  const document = new FakeDocument({ image: '1000014014.png', imagePath: path });
  const db = fakeDatabase(new Map([['OUTLET/outlet/PRODUCT/product', document]]));
  const { bucket, objects } = fakeBucket();
  const active = Buffer.from([...png, 99]);
  objects.set('product_images/1000014014.png', active); objects.set(path, png);
  assert.deepEqual((await readMasterImage(db, bucket, 'products', 'outlet', 'product')).bytes, active);
  objects.delete('product_images/1000014014.png');
  await assert.rejects(readMasterImage(db, bucket, 'products', 'outlet', 'product'), /saved image is unavailable/);
  document.data.image = 'https://example.com/a.png';
  await assert.rejects(readMasterImage(db, bucket, 'products', 'outlet', 'product'), /No saved image/);
  document.data.image = null;
  assert.deepEqual((await readMasterImage(db, bucket, 'products', 'outlet', 'product')).bytes, png);
});

test('filename fallback cannot read arbitrary paths, URLs or categories and does not invent a bucket', async () => {
  for (const image of ['../other.png', 'folder/a.png', 'https://example.com/a.png', 'gs://bucket/a.png', 'a%2fb.png', 'a\\b.png', 'a.png?token=x', 'a.png\n', 123, null]) {
    assert.equal(productImageStoragePath(image), undefined);
    const document = new FakeDocument({ image });
    const db = fakeDatabase(new Map([['OUTLET/outlet/PRODUCT/product', document]]));
    await assert.rejects(readMasterImage(db, fakeBucket().bucket, 'products', 'outlet', 'product'), /No saved image/);
    assert.deepEqual(document.updates, []);
  }
  const db = fakeDatabase(new Map([
    ['OUTLET/outlet/PRODUCT/product', new FakeDocument({ image: '1000014014.png' })],
    ['OUTLET/outlet/CATEGORY/category', new FakeDocument({ image: '1000014014.png' })],
  ]));
  await assert.rejects(readMasterImage(db, fakeBucket().bucket, 'products', 'outlet', 'product'), /saved image is unavailable/);
  await assert.rejects(readMasterImage(db, fakeBucket().bucket, 'categories', 'outlet', 'category'), /No saved image/);
});

test('removing an image clears both existing product references without deleting shared Storage bytes', async () => {
  for (const withWebPath of [false, true]) {
    const path = 'sensible_images/OUTLET/outlet/PRODUCT_IMAGES/product/abc123.png';
    const document = new FakeDocument({ name: 'Tea', price: 12, image: '1000014014.png', ...(withWebPath ? { imagePath: path } : {}) });
    const db = fakeDatabase(new Map([['OUTLET/outlet/PRODUCT/product', document]]));
    const { bucket, objects } = fakeBucket(); objects.set('product_images/1000014014.png', png); objects.set(path, png);
    await removeMasterImage(db, 'products', 'outlet', 'product');
    assert.deepEqual(document.data, { name: 'Tea', price: 12, image: null });
    assert.equal(objects.size, 2);
    await assert.rejects(readMasterImage(db, bucket, 'products', 'outlet', 'product'), /No saved image/);
  }
});

test('new product upload creates only image and no imagePath', async () => {
  const initial = { name: 'Tea', price: 12, currentStock: 7, image: null };
  const document = new FakeDocument(initial);
  const db = fakeDatabase(new Map([['OUTLET/outlet/PRODUCT/product', document]]));
  const { bucket } = fakeBucket();
  const saved = await uploadMasterImage(db, bucket, 'products', 'outlet', 'product', png, 'image/png');
  assert.deepEqual(document.updates, [{ image: saved.image }]);
  assert.deepEqual(document.data, { ...initial, image: saved.image });
  assert.equal(typeof saved.image, 'string'); assert.equal(saved.imagePath, undefined);
});

 test('product upload accepts the exact 30 KB boundary; reading larger legacy images remains supported', async () => {
  const document = new FakeDocument({ image: 'legacy.png' });
  const db = fakeDatabase(new Map([['OUTLET/outlet/PRODUCT/product', document]]));
  const { bucket, objects } = fakeBucket();
  const large = Buffer.concat([png, Buffer.alloc(30 * 1024)]);
  objects.set('product_images/legacy.png', large);
  assert.equal((await readMasterImage(db, bucket, 'products', 'outlet', 'product')).bytes.length, large.length);
  const boundary = Buffer.concat([png, Buffer.alloc(30 * 1024 - png.length)]);
  const result = await uploadMasterImage(db, bucket, 'products', 'outlet', 'product', boundary, 'image/png');
  assert.equal(objects.get(`product_images/${result.image}`)?.length, 30 * 1024);
});
