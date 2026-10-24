import { productImageReference } from './imageApi.ts';
import type JSZip from 'jszip';

export interface ImageProduct { documentId: string; fields: Record<string, unknown> }
export interface ImageTarget { documentId: string; expectedImage: string | null; expectedImagePath: string | null; replaceExisting: boolean }
export interface ImageResult { documentId: string; status: 'saved' | 'unchanged' | 'failed'; message: string }
export const MAX_BATCH_IMAGES = 50;
export const MAX_ZIP_BYTES = 25 * 1024 * 1024;
const MAX_ENTRY_BYTES = 30 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 100 * 1024 * 1024;

export function normalizedImageName(name: string): string {
  return name.trim().replace(/\.(?:jpe?g|png|webp)$/i, '').trim().replace(/\s+/g, ' ').toLowerCase();
}
export function imageCandidates(name: string, products: ImageProduct[]): ImageProduct[] {
  const normalized = normalizedImageName(name);
  return products.filter(product => typeof product.fields.name === 'string'
    && product.fields.name.trim().replace(/\s+/g, ' ').toLowerCase() === normalized);
}
export function imageTarget(product: ImageProduct, replaceExisting = false): ImageTarget {
  const saved = (value: unknown) => typeof value === 'string' && value ? value : null;
  return { documentId: product.documentId, expectedImage: saved(product.fields.image), expectedImagePath: saved(product.fields.imagePath), replaceExisting };
}
export function needsReplacement(product: ImageProduct): boolean { return !!productImageReference(product.fields); }
export function conflictingProducts(rows: { included: boolean; targets: string[] }[]): Set<string> {
  const seen = new Set<string>(), conflicts = new Set<string>();
  for (const row of rows) if (row.included) for (const target of row.targets) {
    if (seen.has(target)) conflicts.add(target);
    seen.add(target);
  }
  return conflicts;
}

interface ZipEntry { name: string; size: number; compressed: number; crc: number; directory: boolean }
function invalidZip(): never { throw new Error('Invalid or unsupported ZIP. Use a standard, unencrypted ZIP of JPEG, PNG, or WebP images.'); }

// Check central and local headers before JSZip can normalize names or inflate data.
// ZIP64, split archives, encryption, traversal, links and special files are rejected.
export function inspectImageZip(bytes: Uint8Array): ZipEntry[] {
  if (bytes.length > MAX_ZIP_BYTES) throw new Error('ZIP files must be 25 MB or smaller.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 22) invalidZip();
  let end = bytes.length - 22;
  for (; end >= Math.max(0, bytes.length - 65557); end--) {
    if (view.getUint32(end, true) === 0x06054b50 && end + 22 + view.getUint16(end + 20, true) === bytes.length) break;
  }
  if (end < 0 || end < bytes.length - 65557) invalidZip();
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) invalidZip();
  const count = view.getUint16(end + 10, true);
  if (!count || count > 200) throw new Error('A ZIP may contain at most 200 entries and 50 images.');
  if (view.getUint16(end + 8, true) !== count) invalidZip();
  const directorySize = view.getUint32(end + 12, true), directoryOffset = view.getUint32(end + 16, true);
  if (directoryOffset + directorySize !== end) invalidZip();
  const entries: ZipEntry[] = [], names = new Set<string>();
  let cursor = directoryOffset, expanded = 0;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || view.getUint32(cursor, true) !== 0x02014b50) invalidZip();
    const flags = view.getUint16(cursor + 8, true), method = view.getUint16(cursor + 10, true);
    const compressed = view.getUint32(cursor + 20, true), size = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true), extraLength = view.getUint16(cursor + 30, true), commentLength = view.getUint16(cursor + 32, true);
    const offset = view.getUint32(cursor + 42, true), attributes = view.getUint32(cursor + 38, true) >>> 16;
    if (cursor + 46 + nameLength + extraLength + commentLength > end || flags & 0x41 || ![0, 8].includes(method)
      || view.getUint16(cursor + 34, true) || (attributes & 0xf000) && ![0x8000, 0x4000].includes(attributes & 0xf000)) invalidZip();
    const rawName = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
    let name: string;
    try { name = decoder.decode(rawName); } catch { invalidZip(); }
    if (!name || name.length > 400 || name.startsWith('/') || name.includes('\\') || name.includes(':')
      || [...name].some(character => character.charCodeAt(0) < 32)) invalidZip();
    const directory = name.endsWith('/');
    const parts = (directory ? name.slice(0, -1) : name).split('/');
    if (parts.some(part => !part || part === '.' || part === '..') || names.has(name)) invalidZip();
    names.add(name);
    if (size > MAX_ENTRY_BYTES || compressed > MAX_ZIP_BYTES || size > Math.max(1024 * 1024, compressed * 200)) {
      throw new Error('ZIP entry exceeds the 30 MB or compression-ratio limit.');
    }
    expanded += size;
    if (expanded > MAX_EXPANDED_BYTES) throw new Error('ZIP contents must total 100 MB or smaller.');
    if (offset + 30 > directoryOffset || view.getUint32(offset, true) !== 0x04034b50
      || view.getUint16(offset + 6, true) !== flags || view.getUint16(offset + 8, true) !== method) invalidZip();
    const localNameLength = view.getUint16(offset + 26, true), localExtraLength = view.getUint16(offset + 28, true);
    if (localNameLength !== nameLength || offset + 30 + localNameLength + localExtraLength + compressed > directoryOffset) invalidZip();
    if (!rawName.every((value, index) => value === bytes[offset + 30 + index])) invalidZip();
    entries.push({ name, size, compressed, crc: view.getUint32(cursor + 16, true), directory });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  if (cursor !== end) invalidZip();
  const images = entries.filter(entry => !entry.directory && /\.(?:jpe?g|png|webp)$/i.test(entry.name.trim()));
  if (!images.length || images.length > MAX_BATCH_IMAGES) throw new Error('Choose a ZIP containing 1–50 JPEG, PNG, or WebP images.');
  return images;
}

const crcTable = Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
export function imageCrc32(bytes: Uint8Array, initial = 0xffffffff): number {
  let crc = initial;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255]!;
  return crc >>> 0;
}

export async function readImageZip(file: File): Promise<File[]> {
  if (file.size > MAX_ZIP_BYTES) throw new Error('ZIP files must be 25 MB or smaller.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const entries = inspectImageZip(bytes);
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(bytes, { createFolders: false });
  const files: File[] = [];
  for (const entry of entries) {
    const archived = zip.file(entry.name);
    if (!archived) invalidZip();
    // Stop inflation on actual emitted bytes as well as advertised header sizes.
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let length = 0, crc = 0xffffffff;
    await new Promise<void>((resolve, reject) => {
      // This streaming API exists in the installed JSZip runtime; its bundled
      // JSZipObject typings omit it. Avoid async('blob'), which buffers unbounded output.
      const stream = (archived as typeof archived & {
        internalStream(type: 'uint8array'): JSZip.JSZipStreamHelper<Uint8Array>;
      }).internalStream('uint8array');
      stream.on('data', chunk => {
        length += chunk.byteLength;
        if (length > entry.size || length > MAX_ENTRY_BYTES) { stream.pause(); reject(new Error('ZIP entry expanded beyond its declared size.')); return; }
        crc = imageCrc32(chunk, crc); chunks.push(Uint8Array.from(chunk));
      }).on('error', reject).on('end', () => {
        if (length !== entry.size || ((crc ^ 0xffffffff) >>> 0) !== entry.crc) reject(new Error('ZIP entry failed its size or checksum validation.'));
        else resolve();
      }).resume();
    });
    const name = entry.name.split('/').at(-1)!;
    const type = /\.png$/i.test(name.trim()) ? 'image/png' : /\.webp$/i.test(name.trim()) ? 'image/webp' : 'image/jpeg';
    files.push(new File(chunks, name, { type }));
  }
  return files;
}

export async function runImageWorkers<T>(items: T[], work: (item: T) => Promise<void>, concurrency = 2): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) await work(items[next++]!);
  }));
}
