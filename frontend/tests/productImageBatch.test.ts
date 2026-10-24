import assert from 'node:assert/strict';
import test from 'node:test';
import JSZip from 'jszip';
import { conflictingProducts, imageCandidates, imageTarget, inspectImageZip, MAX_ZIP_BYTES,
  normalizedImageName, readImageZip, runImageWorkers } from '../src/pages/productImageBatch.ts';

const products = [
  { documentId: 'a', fields: { name: ' Masala   Dosa ', image: 'old.png', imagePath: 'legacy/path' } },
  { documentId: 'b', fields: { name: 'Coffee (Large)' } },
  { documentId: 'c', fields: { name: 'TEA' } },
  { documentId: 'd', fields: { name: 'tea' } },
];
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
async function archive(names = ['Masala Dosa.png', 'nested/Coffee (Large).png']) {
  const zip = new JSZip();
  for (const name of names) zip.file(name, png);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
function central(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { view, offset: view.getUint32(bytes.length - 6, true) };
}

test('filename matching ignores only case, extension and whitespace; ambiguity is explicit', () => {
  assert.equal(normalizedImageName(' Masala   Dosa.JPG'), 'masala dosa');
  assert.equal(normalizedImageName(' Masala   Dosa.JPG  '), 'masala dosa');
  assert.deepEqual(imageCandidates('masala dosa.png', products).map(product => product.documentId), ['a']);
  assert.deepEqual(imageCandidates('Coffee Large.png', products), []);
  assert.deepEqual(imageCandidates('Coffee (Large).jpg', products).map(product => product.documentId), ['b']);
  assert.equal(imageCandidates('Tea.webp', products).length, 2);
  assert.equal(imageCandidates('Masala Dosaa.png', products).length, 0);
  assert.deepEqual(imageTarget(products[0]!), { documentId: 'a', expectedImage: 'old.png', expectedImagePath: 'legacy/path', replaceExisting: false });
});

test('multiple images cannot silently target one product; excluding a row resolves the conflict', () => {
  assert.deepEqual([...conflictingProducts([{ included: true, targets: ['a'] }, { included: true, targets: ['a', 'b'] }])], ['a']);
  assert.equal(conflictingProducts([{ included: true, targets: ['a'] }, { included: false, targets: ['a'] }]).size, 0);
});

test('ZIP entries decode in memory with their exact bytes; same basenames remain separate review entries', async () => {
  const bytes = await archive(['Masala Dosa.png', 'nested/Masala Dosa.png']);
  const files = await readImageZip(new File([Uint8Array.from(bytes)], 'images.zip'));
  assert.equal(files.length, 2);
  assert.equal(files[0]!.name, files[1]!.name);
  assert.deepEqual(new Uint8Array(await files[0]!.arrayBuffer()), png);
});

test('malformed ZIPs, traversal, absolute paths and unsafe local names are rejected before extraction', async () => {
  for (const name of ['../escape.png', '/root.png', 'C:\\root.png', 'a/../../escape.png', 'bad\u0000.png']) {
    const bytes = await archive([name]); assert.throws(() => inspectImageZip(bytes), /Invalid/);
  }
  assert.throws(() => inspectImageZip(new Uint8Array(12)), /Invalid/);
  assert.throws(() => inspectImageZip(new Uint8Array(MAX_ZIP_BYTES + 1)), /25 MB/);
  const mismatch = await archive(['Tea.png']);
  mismatch[30] = 90; assert.throws(() => inspectImageZip(mismatch), /Invalid/);
});

test('entry count, expansion, encryption, special files and compression-ratio limits fail closed', async () => {
  const tooMany = await archive(Array.from({ length: 51 }, (_, index) => `${index}.png`));
  assert.throws(() => inspectImageZip(tooMany), /1–50/);
  for (const mutate of [
    (v: DataView, o: number) => v.setUint32(o + 24, 31 * 1024 * 1024, true),
    (v: DataView, o: number) => v.setUint32(o + 24, 2 * 1024 * 1024, true),
    (v: DataView, o: number) => v.setUint16(o + 8, 1, true),
    (v: DataView, o: number) => v.setUint32(o + 38, 0xa000 << 16, true),
  ]) {
    const bytes = await archive(['Tea.png']); const { view, offset } = central(bytes); mutate(view, offset);
    assert.throws(() => inspectImageZip(bytes));
  }
});

test('duplicate archive paths, dishonest inflated lengths and checksum failures are rejected', async () => {
  const duplicate = await archive(['Tea.png', 'Pea.png']);
  for (let i = 0; i < duplicate.length - 7; i++) {
    if (String.fromCharCode(...duplicate.slice(i, i + 7)) === 'Pea.png') duplicate[i] = 84;
  }
  assert.throws(() => inspectImageZip(duplicate), /Invalid/);
  for (const checksum of [false, true]) {
    const bytes = await archive(['Tea.png']); const { view, offset } = central(bytes);
    if (checksum) view.setUint32(offset + 16, 1234, true);
    else view.setUint32(offset + 24, 1, true);
    await assert.rejects(readImageZip(new File([Uint8Array.from(bytes)], 'bad.zip')));
  }
});

test('total expanded size is bounded independently of individual entries', async () => {
  const zip = new JSZip();
  for (let i = 0; i < 4; i++) zip.file(`${i}.png`, new Uint8Array(256 * 1024));
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'STORE' });
  const { view, offset } = central(bytes);
  let cursor = offset;
  for (let i = 0; i < 4; i++) {
    view.setUint32(cursor + 24, 30 * 1024 * 1024, true);
    cursor += 46 + view.getUint16(cursor + 28, true) + view.getUint16(cursor + 30, true) + view.getUint16(cursor + 32, true);
  }
  assert.throws(() => inspectImageZip(bytes), /100 MB/);
});

test('bulk work uses at most two concurrent operations and finishes every item', async () => {
  let active = 0, maximum = 0; const done: number[] = [];
  await runImageWorkers([1, 2, 3, 4, 5], async item => {
    active++; maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 5)); done.push(item); active--;
  });
  assert.equal(maximum, 2); assert.deepEqual(done.sort(), [1, 2, 3, 4, 5]);
});
