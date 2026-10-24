import { createHash, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';
import { ProductCreationError, requireProductOutlet } from './productCreation.js';
import { verifyProfileQuickPin } from './quickPin.js';

const input = z.object({ action: z.enum(['bulk', 'shared', 'remove']), quickPin: z.string().regex(/^\d{4}$/) }).strict();
const audience = 'product-image-management';
const sessionDigest = (session: string) => createHash('sha256').update(session).digest('hex');
function requireKey(secret: string) {
  if (secret.length < 32) throw new ProductCreationError(503, 'Quick PIN authorization requires a configured signing key of at least 32 characters.');
}

export async function verifyProductImagePin(db: Firestore, outletId: string, profileId: string | null,
  assigned: (profile: Record<string, unknown>) => string[], secret: string, session: string, raw: unknown) {
  if (!profileId) throw new ProductCreationError(401, 'Your session has expired. Please sign in again.');
  requireKey(secret);
  const parsed = input.safeParse(raw);
  if (!parsed.success) throw new ProductCreationError(400, 'Enter your 4-digit login Quick PIN.');
  const profile = (await db.collection('USER_PROFILE').doc(profileId).get()).data();
  requireProductOutlet(profileId, outletId, profile, assigned);
  verifyProfileQuickPin(profileId, profile!, parsed.data.quickPin);
  return { verified: true, action: parsed.data.action, imageToken: jwt.sign({ outletId, action: parsed.data.action,
    session: sessionDigest(session) }, secret, { algorithm: 'HS256', subject: profileId, audience, jwtid: randomUUID(), expiresIn: '15m' }) };
}

// Grants live only for the selected workflow; normal session and outlet checks still run on every write.
export function requireProductImageAuthorization(secret: string, grant: string | undefined, profileId: string,
  outletId: string, session: string, actions: string[]) {
  requireKey(secret);
  try {
    const data = jwt.verify(grant ?? '', secret, { audience, algorithms: ['HS256'] });
    if (typeof data === 'string' || data.sub !== profileId || data.outletId !== outletId
      || data.session !== sessionDigest(session) || !actions.includes(data.action)) throw new Error();
  } catch { throw new ProductCreationError(403, 'Quick PIN authorization expired or is invalid. Close this action and verify your Quick PIN again.'); }
}
