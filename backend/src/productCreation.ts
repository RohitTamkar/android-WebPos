import { z } from 'zod';
import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { productFields } from './productDefaults.js';
import { allocateProductCodes, nextProductCode, type ImportTax } from './productImportValidation.js';

// The user confirmed number; its unitId is verified by the existing POS serializer.
export const PRODUCT_UNITS = [{ id: 2, name: 'number' }];
const price = z.number().finite().nonnegative();
export const newProductSchema = z.object({
  requestId: z.uuid(), code: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  name: z.string().trim().min(1, 'Product Name is required.').max(200),
  price, mrpPrice: price, costPrice: price,
  category: z.string().min(1, 'Category is required.').refine(value => !value.includes('/'), 'Select a valid category.'),
  regionalName: z.string().trim().max(200).default(''), discount: z.number().finite().min(0).max(100),
  shortName: z.string().trim().max(200).default(''), taxIndex: z.number().int().nonnegative(),
  hsnCode: z.string().trim().max(200).default(''), unitId: z.number().int(),
  weighable: z.boolean(), stockable: z.boolean(),
});
export class ProductCreationError extends Error {
  constructor(public status: number, message: string, public errors: Record<string, string> = {}, public nextCode?: number) { super(message); }
}
export function requireProductOutlet(profileId: string | null, outletId: string, profile: Record<string, unknown> | undefined, assignedOutlets: (profile: Record<string, unknown>) => string[]) {
  if (!profileId) throw new ProductCreationError(401, 'Your session has expired. Please sign in again.');
  if (!outletId || outletId.includes('/')) throw new ProductCreationError(400, 'A valid outlet is required.');
  if (!profile || profile.active !== true || !assignedOutlets(profile).includes(outletId)) {
    throw new ProductCreationError(403, 'You do not have access to this outlet.');
  }
}
export function productTaxes(records: { percent?: unknown; index?: unknown; type?: unknown }[]): ImportTax[] {
  return records.filter(record => record.type === 0 && typeof record.percent === 'number'
    && Number.isFinite(record.percent) && typeof record.index === 'number' && Number.isSafeInteger(record.index)
    && record.index >= 0).map(record => ({ percent: record.percent as number, index: record.index as number, type: 0 }));
}
export function validateNewProduct(raw: unknown, categories: string[], taxes: ImportTax[]) {
  const parsed = newProductSchema.safeParse(raw);
  if (!parsed.success) throw new ProductCreationError(422, 'Check the highlighted fields.', Object.fromEntries(parsed.error.issues.map(issue => [String(issue.path[0]), issue.message])));
  const data = parsed.data;
  validateProductReferences(data, categories, taxes);
  return data;
}
export function validateProductReferences(data: { category: string; taxIndex: number; unitId: number }, categories: string[], taxes: ImportTax[]) {
  const errors: Record<string, string> = {};
  if (!categories.includes(data.category)) errors.category = 'Select an existing category for this outlet.';
  if (taxes.filter(tax => tax.index === data.taxIndex).length !== 1) errors.taxIndex = 'Select an unambiguous configured GST tax.';
  if (!PRODUCT_UNITS.some(unit => unit.id === data.unitId)) errors.unitId = 'Select a supported POS unit.';
  if (Object.keys(errors).length) throw new ProductCreationError(422, 'Check the highlighted fields.', errors);
}

export async function createOutletProduct(db: Firestore, outletId: string, profileId: string | null, assignedOutlets: (profile: Record<string, unknown>) => string[], raw: unknown) {
  // Reject absent sessions and invalid paths before constructing any database references.
  if (!profileId) throw new ProductCreationError(401, 'Your session has expired. Please sign in again.');
  if (!outletId || outletId.includes('/')) throw new ProductCreationError(400, 'A valid outlet is required.');
  const outlet = db.collection('OUTLET').doc(outletId);
  return db.runTransaction(async transaction => {
    const profile = await transaction.get(db.collection('USER_PROFILE').doc(profileId));
    requireProductOutlet(profileId, outletId, profile.data(), assignedOutlets);
    const [products, categories, taxes] = await Promise.all([
      transaction.get(outlet.collection('PRODUCT')),
      transaction.get(outlet.collection('CATEGORY')),
      transaction.get(db.collection('MASTERS').doc('masters').collection('TAX_MASTER')),
    ]);
    const data = validateNewProduct(raw, categories.docs.map(doc => doc.id), productTaxes(taxes.docs.map(doc => doc.data())));
    const existing = products.docs.map(doc => ({ id: doc.id, fields: doc.data() }));
    const allocated = allocateProductCodes(outletId, [{ rowNumber: 1, sourceIdentity: `manual:${data.requestId}`,
      fields: productFields(data, data.code, '0') }], existing)[0]!;
    const id = String(allocated.fields.id);
    const saved = products.docs.find(doc => doc.id === id);
    // A lost response can be retried using the same request ID without a second create.
    if (saved) return { documentId: id, fields: saved.data() };
    if (allocated.fields.code !== data.code) throw new ProductCreationError(409,
      'The next Code changed. Review the updated Code and save again.', {}, nextProductCode(existing));
    const fields: Record<string, unknown> = { ...allocated.fields, dateTme: Timestamp.now() };
    transaction.create(outlet.collection('PRODUCT').doc(id), fields);
    return { documentId: id, fields };
  });
}
