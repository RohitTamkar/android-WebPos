import { PRODUCT_IMAGE_MAX_BYTES } from './productImageProcessing.ts';
import { createRequestId } from '../utils/requestId.ts';
export type ImageEntity = 'products' | 'categories';

// This value only triggers the authenticated record endpoint; it is never fetched
// as a URL or sent to the server as a caller-selected Storage path.
export function productImageReference(fields: Record<string, unknown> | undefined): string | undefined {
  if (typeof fields?.image === 'string' && fields.image.length > 0) return fields.image;
  return typeof fields?.imagePath === 'string' && fields.imagePath.length > 0 ? fields.imagePath : undefined;
}

function imageUrl(outletId: string, entity: ImageEntity, documentId: string) {
  return `/api/outlets/${encodeURIComponent(outletId)}/${entity}/${encodeURIComponent(documentId)}/image`;
}

async function imageRequest(url: string, token: string, init: RequestInit, fallback: string): Promise<{ image?: string; imagePath?: string }> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(url, { ...init, headers });
  if (response.status === 401) throw Object.assign(new Error('Your session has expired. Please sign in again.'), { status: 401 });
  const payload = await response.json() as { success?: boolean; data?: { image?: string; imagePath?: string }; message?: string };
  if (!response.ok || payload.success !== true) throw new Error(payload.message || fallback);
  return payload.data ?? {};
}

const imageOperations = new WeakMap<File, Map<string, { requestId: string; expectedReference: string | null }>>();

export async function uploadMasterImage(outletId: string, entity: ImageEntity, documentId: string, token: string, file: File, expectedReference?: string | null) {
  if (entity === 'products' && file.size > PRODUCT_IMAGE_MAX_BYTES) throw new Error('Product images must be 30 KB or smaller. Apply a crop before uploading.');
  const headers: Record<string, string> = { 'Content-Type': file.type };
  if (entity === 'products' && expectedReference !== undefined) {
    const key = JSON.stringify([outletId, documentId]);
    const operations = imageOperations.get(file) ?? new Map();
    const operation = operations.get(key) ?? { requestId: createRequestId(), expectedReference };
    operations.set(key, operation); imageOperations.set(file, operations);
    headers['X-Image-Upload-Id'] = operation.requestId;
    headers['X-Image-Expected-Reference'] = JSON.stringify(operation.expectedReference);
  }
  const result = await imageRequest(imageUrl(outletId, entity, documentId), token, {
    method: 'PUT', headers, body: file,
  }, 'Unable to save the image.');
  const reference = entity === 'products' ? result.image : result.imagePath;
  if (!reference) throw new Error('Image upload completed without a saved image reference.');
  return reference;
}

export async function removeMasterImage(outletId: string, entity: ImageEntity, documentId: string, token: string,
  reviewed?: { image: string | null; imagePath: string | null }, imageGrant?: string) {
  const url = entity === 'products' && reviewed
    ? `/api/outlets/${encodeURIComponent(outletId)}/product-image-removals/${encodeURIComponent(documentId)}`
    : imageUrl(outletId, entity, documentId);
  await imageRequest(url, token, {
    method: 'DELETE', ...(reviewed ? { headers: { 'Content-Type': 'application/json', ...(imageGrant ? { 'X-Image-Token': imageGrant } : {}) }, body: JSON.stringify(reviewed) } : {}),
  }, 'Unable to remove the image.');
}

export function masterImageUrl(outletId: string, entity: ImageEntity, documentId: string) {
  return imageUrl(outletId, entity, documentId);
}
