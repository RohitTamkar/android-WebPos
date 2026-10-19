import { createHash, timingSafeEqual } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';
import { ProductCreationError, requireProductOutlet } from './productCreation.js';

const inputSchema = z.object({ destinationOutletId: z.string().min(1).max(200), quickPin: z.string().regex(/^\d{4,6}$/) }).strict();
const attempts = new Map<string, { count: number; expires: number }>();
const digest = (value: string) => createHash('sha256').update(value).digest();

// Recheck the signed-in user's existing QuickPin. Reads only; no PIN or outlet records are changed.
export async function verifyTransferPreviewPin(db: Firestore, sourceOutletId: string, profileId: string | null,
  assigned: (profile: Record<string, unknown>) => string[], raw: unknown) {
  if (!profileId) throw new ProductCreationError(401, 'Your session has expired. Please sign in again.');
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) throw new ProductCreationError(400, 'Enter your 4 to 6 digit QuickPin and select a destination outlet.');
  const { destinationOutletId, quickPin } = parsed.data;
  if ([sourceOutletId, destinationOutletId].some(id => !id || id.includes('/') || id === '.' || id === '..') || sourceOutletId === destinationOutletId) {
    throw new ProductCreationError(400, 'Select a different valid destination outlet.');
  }
  const profile = (await db.collection('USER_PROFILE').doc(profileId).get()).data();
  requireProductOutlet(profileId, sourceOutletId, profile, assigned);
  requireProductOutlet(profileId, destinationOutletId, profile, assigned);
  const now = Date.now();
  for (const [id, attempt] of attempts) if (attempt.expires <= now) attempts.delete(id);
  const attempt = attempts.get(profileId);
  if (attempt && attempt.count >= 5) throw new ProductCreationError(429, 'Too many incorrect attempts. Please try again in five minutes.');
  const stored = typeof profile!.quickPin === 'string' || typeof profile!.quickPin === 'number' ? String(profile!.quickPin) : '';
  if (!timingSafeEqual(digest(quickPin), digest(stored)) || !/^\d{4,6}$/.test(stored)) {
    attempts.set(profileId, { count: (attempt?.count ?? 0) + 1, expires: attempt?.expires ?? now + 5 * 60_000 });
    throw new ProductCreationError(422, 'Incorrect QuickPin. Please try again.');
  }
  const outlets = await Promise.all([sourceOutletId, destinationOutletId].map(id => db.collection('OUTLET').doc(id).get()));
  if (outlets.some(outlet => !outlet.exists)) throw new ProductCreationError(404, 'An outlet is no longer available.');
  attempts.delete(profileId);
  return { verified: true, destinationOutletId };
}
