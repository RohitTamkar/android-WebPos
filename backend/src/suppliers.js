import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { ProductCreationError, requireProductOutlet } from './productCreation.js';
const pathId = z.string().min(1).max(200).refine(value => !value.includes('/') && value !== '.' && value !== '..');
const supplierFields = z.object({
    name: z.string().min(1).max(200).refine(value => !!value.trim()),
    mobile: z.string().min(1).max(200).refine(value => !!value.trim()),
    address: z.string().max(500), alternateNumber: z.string().max(200),
    email: z.string().max(320), gstin: z.string().max(200),
}).strict();
const schema = z.object({ documentId: z.string().regex(/^[A-Za-z0-9]{20}$/), fields: supplierFields }).strict();
// A master stores id:null and alternateNumber:string. The existing goods receipt
// format stores its document ID in the embedded supplier.id and alternateNumber:null.
// Keep these two representations separate rather than rewriting either schema.
export function receiptSupplierFromMaster(documentId, fields) {
    if (!fields || fields.id !== null)
        return null;
    const { id: _id, ...values } = fields;
    const parsed = supplierFields.safeParse(values);
    if (!parsed.success)
        return null;
    return { ...parsed.data, id: documentId, alternateNumber: null };
}
export async function createOutletSupplier(run, outletId, profileId, assigned, raw) {
    if (!profileId)
        throw new ProductCreationError(401, 'Your session has expired. Please sign in again.');
    const parsed = schema.safeParse(raw);
    if (!pathId.safeParse(outletId).success || !parsed.success)
        throw new ProductCreationError(422, 'Enter a supplier name, mobile and valid supplier details.');
    const { documentId, fields: values } = parsed.data;
    return run(async (transaction) => {
        requireProductOutlet(profileId, outletId, await transaction.read(`USER_PROFILE/${profileId}`), assigned);
        if ((await transaction.read(`OUTLET/${outletId}`))?.active !== true)
            throw new ProductCreationError(403, 'This outlet is inactive or unavailable.');
        const path = `OUTLET/${outletId}/SUPPLIER/${documentId}`;
        const previous = await transaction.read(path);
        const stored = { ...values, id: null };
        if (previous) {
            if (!isDeepStrictEqual(previous, stored))
                throw new ProductCreationError(409, 'This confirmation already saved different supplier details.');
            return { documentId, fields: stored, alreadySaved: true };
        }
        const fields = { ...Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { stringValue: value }])), id: { nullValue: null } };
        transaction.create(path, fields);
        return { documentId, fields: stored, alreadySaved: false };
    });
}
//# sourceMappingURL=suppliers.js.map