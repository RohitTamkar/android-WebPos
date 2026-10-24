import { z } from 'zod';
import { Timestamp } from 'firebase-admin/firestore';
import { productFields } from './productDefaults.js';
import { allocateProductCodes, nextProductCode } from './productImportValidation.js';
import { ANDROID_TAX_OPTIONS } from '../../shared/androidTaxes.js';
// Follow the supplied POS unit order, preserving the existing NUMBER unitId (2).
export const PRODUCT_UNITS = [
    { id: 0, name: 'KILOGRAM' },
    { id: 1, name: 'LITER' },
    { id: 2, name: 'NUMBER' },
    { id: 3, name: 'MILLILITRE' },
    { id: 4, name: 'BOX' },
    { id: 5, name: 'TIN' },
    { id: 6, name: 'JAR' },
    { id: 7, name: 'BOTTLE' },
    { id: 8, name: 'GRAM' },
    { id: 9, name: 'METER' },
    { id: 10, name: 'DOZEN' },
    { id: 11, name: 'BAG' },
    { id: 12, name: 'PIECE' },
];
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
    wholeSaleAmount: price.optional(), onlinePrice: price.optional(),
});
export class ProductCreationError extends Error {
    status;
    errors;
    nextCode;
    constructor(status, message, errors = {}, nextCode) {
        super(message);
        this.status = status;
        this.errors = errors;
        this.nextCode = nextCode;
    }
}
export function requireProductOutlet(profileId, outletId, profile, assignedOutlets) {
    if (!profileId)
        throw new ProductCreationError(401, 'Your session has expired. Please sign in again.');
    if (!outletId || outletId.includes('/'))
        throw new ProductCreationError(400, 'A valid outlet is required.');
    if (!profile || profile.active !== true || !assignedOutlets(profile).includes(outletId)) {
        throw new ProductCreationError(403, 'You do not have access to this outlet.');
    }
}
export function productTaxes(records) {
    return records.filter(record => record.type === 0 && typeof record.percent === 'number'
        && Number.isFinite(record.percent) && typeof record.index === 'number' && Number.isSafeInteger(record.index)
        && record.index >= 0).map(record => ({ percent: record.percent, index: record.index, type: 0 }));
}
export function validateNewProduct(raw, categories, taxes) {
    const parsed = newProductSchema.safeParse(raw);
    if (!parsed.success)
        throw new ProductCreationError(422, 'Check the highlighted fields.', Object.fromEntries(parsed.error.issues.map(issue => [String(issue.path[0]), issue.message])));
    const data = parsed.data;
    validateProductReferences(data, categories, taxes);
    return data;
}
export function validateProductReferences(data, categories, taxes) {
    const errors = {};
    if (!categories.includes(data.category))
        errors.category = 'Select an existing category for this outlet.';
    if (taxes.filter(tax => tax.index === data.taxIndex).length !== 1)
        errors.taxIndex = 'Select an unambiguous configured GST tax.';
    if (!PRODUCT_UNITS.some(unit => unit.id === data.unitId))
        errors.unitId = 'Select a supported POS unit.';
    if (Object.keys(errors).length)
        throw new ProductCreationError(422, 'Check the highlighted fields.', errors);
}
export async function createOutletProduct(db, outletId, profileId, assignedOutlets, raw) {
    // Reject absent sessions and invalid paths before constructing any database references.
    if (!profileId)
        throw new ProductCreationError(401, 'Your session has expired. Please sign in again.');
    if (!outletId || outletId.includes('/'))
        throw new ProductCreationError(400, 'A valid outlet is required.');
    const outlet = db.collection('OUTLET').doc(outletId);
    return db.runTransaction(async (transaction) => {
        const profile = await transaction.get(db.collection('USER_PROFILE').doc(profileId));
        requireProductOutlet(profileId, outletId, profile.data(), assignedOutlets);
        const [products, categories] = await Promise.all([
            transaction.get(outlet.collection('PRODUCT')),
            transaction.get(outlet.collection('CATEGORY')),
        ]);
        const data = validateNewProduct(raw, categories.docs.map(doc => doc.id), ANDROID_TAX_OPTIONS);
        const existing = products.docs.map(doc => ({ id: doc.id, fields: doc.data() }));
        const allocated = allocateProductCodes(outletId, [{ rowNumber: 1, sourceIdentity: `manual:${data.requestId}`,
                fields: productFields(data, data.code, '0') }], existing)[0];
        const id = String(allocated.fields.id);
        const saved = products.docs.find(doc => doc.id === id);
        // A lost response can be retried using the same request ID without a second create.
        if (saved)
            return { documentId: id, fields: saved.data() };
        if (allocated.fields.code !== data.code)
            throw new ProductCreationError(409, 'The next Code changed. Review the updated Code and save again.', {}, nextProductCode(existing));
        const fields = { ...allocated.fields, dateTme: Timestamp.now() };
        transaction.create(outlet.collection('PRODUCT').doc(id), fields);
        return { documentId: id, fields };
    });
}
//# sourceMappingURL=productCreation.js.map