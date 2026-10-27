import { rememberImagePreview } from './imagePreviewLoader.ts';
import { masterImageUrl } from './imageApi.ts';
import { PRODUCT_IMAGE_MAX_BYTES } from './productImageProcessing.ts';
import type { ImageResult, ImageTarget } from './productImageBatch.ts';

export async function assignProductImage(outletId: string, token: string, requestId: string, file: File, targets: ImageTarget[], imageGrant?: string) {
  if (!file.size || file.size > PRODUCT_IMAGE_MAX_BYTES) throw new Error('Product images must be 512 KB or smaller.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const response = await fetch(`/api/outlets/${encodeURIComponent(outletId)}/product-image-assignments`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(imageGrant ? { 'X-Image-Token': imageGrant } : {}) },
    body: JSON.stringify({ requestId, contentType: file.type, base64: btoa(binary), targets }),
  });
  if (response.status === 401) throw Object.assign(new Error('Your session has expired. Please sign in again.'), { status: 401 });
  const payload = await response.json() as { success?: boolean; message?: string; data?: { image: string; results: ImageResult[] } };
  if (!response.ok || payload.success !== true || !payload.data) throw new Error(payload.message || 'Unable to assign the image. Retry this operation.');
  const data = payload.data;
  if (!/^[a-f0-9]{64}\.(png|jpg|webp)$/.test(data.image) || !Array.isArray(data.results)
    || data.results.length !== targets.length || data.results.some(result => !result || typeof result !== 'object')
    || new Set(data.results.map(result => result.documentId)).size !== targets.length
    || data.results.some(result => !targets.some(target => target.documentId === result.documentId)
      || !['saved', 'unchanged', 'failed'].includes(result.status) || typeof result.message !== 'string')) {
    throw new Error('The assignment response could not be confirmed. Retry to verify current references.');
  }
  for (const result of data.results) if (result.status !== 'failed')
    rememberImagePreview(masterImageUrl(outletId, 'products', result.documentId), data.image, token, file);
  return data;
}
