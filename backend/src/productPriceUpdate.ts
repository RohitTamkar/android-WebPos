import type { Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';
import { ProductCreationError, requireProductOutlet } from './productCreation.js';

const recordId = z.string().min(1).max(200).refine(id => !id.includes('/') && id !== '.' && id !== '..');
const priceKey = z.string().min(1).max(200);
const schema = z.object({
  prices: z.record(priceKey, z.number().finite().nonnegative().max(1e9)),
  expected: z.record(priceKey, z.unknown()),
}).strict();

// Updates values of keys that already exist in the Android priceTable; keys are never added,
// renamed or removed. "default price" stays in sync with the product's price field.
export async function updateProductPrices(db: Firestore, outletId: string, id: string, profileId: string | null,
  assigned: (profile: Record<string, unknown>) => string[], raw: unknown) {
  if (!profileId) throw new ProductCreationError(401, 'Your session has expired. Please sign in again.');
  if (!recordId.safeParse(outletId).success || !recordId.safeParse(id).success) throw new ProductCreationError(400, 'A valid outlet and product ID are required.');
  const parsed = schema.safeParse(raw);
  const keys = parsed.success ? Object.keys(parsed.data.prices) : [];
  if (!parsed.success || !keys.length || keys.length > 100 || keys.some(key => !Object.hasOwn(parsed.data.expected, key))) {
    throw new ProductCreationError(422, 'Enter valid prices of zero or more.');
  }
  const { prices, expected } = parsed.data;
  const reference = db.collection('OUTLET').doc(outletId).collection('PRODUCT').doc(id);
  return db.runTransaction(async transaction => {
    const profile = (await transaction.get(db.collection('USER_PROFILE').doc(profileId))).data();
    requireProductOutlet(profileId, outletId, profile, assigned);
    const product = await transaction.get(reference);
    if (!product.exists) throw new ProductCreationError(404, 'This product no longer exists.');
    const stored = product.data()!;
    let table: unknown = stored.priceTable;
    if (typeof table === 'string') { try { table = JSON.parse(table); } catch { table = null; } }
    if (!table || typeof table !== 'object' || Array.isArray(table)) throw new ProductCreationError(422, 'This product has an invalid price table and cannot be updated safely.');
    const current = table as Record<string, unknown>;
    for (const key of keys) {
      if (!Object.hasOwn(current, key)) throw new ProductCreationError(422, `"${key}" is not a saved price for this product. Reload and try again.`);
      // A value already equal to the request means an earlier attempt succeeded, so retries stay safe.
      if (current[key] !== expected[key] && current[key] !== prices[key]) {
        throw new ProductCreationError(409, 'Prices changed since you loaded the products. Reload and review the prices again.');
      }
    }
    const nextTable = { ...current, ...prices };
    const changes: Record<string, unknown> = { priceTable: typeof stored.priceTable === 'string' ? JSON.stringify(nextTable) : nextTable };
    if ('default price' in prices) changes.price = prices['default price'];
    transaction.update(reference, changes);
    return { documentId: id, fields: { ...stored, ...changes } };
  });
}
