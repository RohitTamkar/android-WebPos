import { createHash, timingSafeEqual } from 'node:crypto';
import { ProductCreationError } from './productCreation.js';

const attempts = new Map<string, { count: number; expires: number }>();
const digest = (value: string) => createHash('sha256').update(value).digest();

// Shared with transfer preview; PIN values never leave this comparison.
export function verifyProfileQuickPin(profileId: string, profile: Record<string, unknown>, quickPin: string) {
  const now = Date.now();
  for (const [id, attempt] of attempts) if (attempt.expires <= now) attempts.delete(id);
  const attempt = attempts.get(profileId);
  if (attempt && attempt.count >= 5) throw new ProductCreationError(429, 'Too many incorrect attempts. Please try again in five minutes.');
  const stored = typeof profile.quickPin === 'string' || typeof profile.quickPin === 'number' ? String(profile.quickPin) : '';
  if (!timingSafeEqual(digest(quickPin), digest(stored)) || !/^\d{4,6}$/.test(stored)) {
    attempts.set(profileId, { count: (attempt?.count ?? 0) + 1, expires: attempt?.expires ?? now + 5 * 60_000 });
    throw new ProductCreationError(422, 'Incorrect QuickPin. Please try again.');
  }
  attempts.delete(profileId);
}
