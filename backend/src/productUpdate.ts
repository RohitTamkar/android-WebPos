import type { Firestore } from 'firebase-admin/firestore';
import { newProductSchema, ProductCreationError, validateProductReferences } from './productCreation.js';
import { ANDROID_TAX_OPTIONS } from '../../shared/androidTaxes.js';

const editableSchema = newProductSchema.omit({ requestId: true, code: true });
const patchSchema = editableSchema.partial().strict();

export async function updateOutletProduct(db: Firestore, outletId: string, id: string, profileId: string | null,
  assignedOutlets: (profile: Record<string, unknown>) => string[], raw: unknown) {
  if (!profileId) throw new ProductCreationError(401, 'Your session has expired. Please sign in again.');
  if (![outletId, id].every(value => value && !value.includes('/') && value !== '.' && value !== '..')) {
    throw new ProductCreationError(400, 'A valid outlet and product ID are required.');
  }
  const outlet = db.collection('OUTLET').doc(outletId);
  const reference = outlet.collection('PRODUCT').doc(id);
  return db.runTransaction(async transaction => {
    const profile = (await transaction.get(db.collection('USER_PROFILE').doc(profileId))).data();
    if (!profile || profile.active !== true || !assignedOutlets(profile).includes(outletId)) {
      throw new ProductCreationError(403, 'You do not have access to this outlet.');
    }
    const patch = patchSchema.safeParse(raw);
    if (!patch.success) throw new ProductCreationError(422, 'Only editable product fields can be updated.',
      Object.fromEntries(patch.error.issues.map(issue => [String(issue.path[0]), issue.message])));
    const [product, categories] = await Promise.all([
      transaction.get(reference), transaction.get(outlet.collection('CATEGORY')),
    ]);
    if (!product.exists) throw new ProductCreationError(404, 'This product no longer exists.');
    const stored = product.data()!;
    // Pick only submitted keys: optional-field defaults must not reset unrelated values.
    const changes: Record<string, unknown> = Object.fromEntries(Object.keys(raw as object)
      .map(key => [key, (patch.data as Record<string, unknown>)[key]]));
    const parsed = editableSchema.safeParse({ ...stored, ...changes });
    if (!parsed.success) throw new ProductCreationError(422, 'Check the highlighted fields.',
      Object.fromEntries(parsed.error.issues.map(issue => [String(issue.path[0]), issue.message])));
    const taxChoices = [...ANDROID_TAX_OPTIONS];
    if (parsed.data.taxIndex === stored.taxIndex && !taxChoices.some(tax => tax.index === stored.taxIndex)) {
      taxChoices.push({ index: parsed.data.taxIndex, name: 'Saved tax', percent: 0, type: 0 });
    }
    // Like the saved tax above, an unchanged category stays valid after its category was deleted.
    const categoryChoices = categories.docs.map(doc => doc.id);
    if (parsed.data.category === stored.category && !categoryChoices.includes(parsed.data.category)) categoryChoices.push(parsed.data.category);
    validateProductReferences(parsed.data, categoryChoices, taxChoices);
    if ('price' in changes && changes.price !== stored.price) {
      let table: unknown;
      try { table = typeof stored.priceTable === 'string' ? JSON.parse(stored.priceTable) : null; } catch { table = null; }
      if (!table || typeof table !== 'object' || Array.isArray(table) || !Object.hasOwn(table, 'default price')) {
        throw new ProductCreationError(422, 'The existing price table cannot be updated safely.', { price: 'The product must have a valid existing default price table before changing Selling Price.' });
      }
      changes.priceTable = JSON.stringify({ ...table, 'default price': parsed.data.price });
    }
    // No set/create: preserve code, ID, barcode, stock, timestamps, flags and custom fields.
    if (Object.keys(changes).length) transaction.update(reference, changes);
    return { documentId: id, fields: { ...stored, ...changes } };
  });
}
