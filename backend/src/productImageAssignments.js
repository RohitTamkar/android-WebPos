import { createHash } from 'node:crypto';
import { z } from 'zod';
import { requireProductOutlet } from './productCreation.js';
import { detectImage, ImageStorageError, PRODUCT_IMAGE_MAX_BYTES, storeVerifiedProductImage } from './imageStorage.js';
const id = z.string().min(1).max(200).refine(value => !value.includes('/') && value !== '.' && value !== '..');
const savedReference = z.string().max(600).nullable();
const requestSchema = z.object({
    requestId: z.string().uuid(),
    contentType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
    base64: z.string().min(4).max(4 * Math.ceil(PRODUCT_IMAGE_MAX_BYTES / 3)),
    targets: z.array(z.object({ documentId: id, expectedImage: savedReference, expectedImagePath: savedReference,
        replaceExisting: z.boolean() }).strict()).min(1).max(50),
}).strict();
function reference(value) {
    if (value === undefined || value === null || value === '')
        return null;
    if (typeof value !== 'string')
        throw new ImageStorageError(409, 'The existing image reference needs review.');
    return value;
}
// An operation has an immutable, outlet/profile-scoped object name. Retries verify
// the object and current references rather than creating another Storage upload.
// No operation records, mapping collections, or additional product fields are used.
export async function assignProductImage(db, bucket, outletId, profileId, assigned, raw) {
    if (!id.safeParse(outletId).success)
        throw new ImageStorageError(400, 'A valid outlet ID is required.');
    const parsed = requestSchema.safeParse(raw);
    if (!parsed.success)
        throw new ImageStorageError(422, 'Select up to 50 products and a processed image no larger than 512 KB.');
    const request = parsed.data;
    if (new Set(request.targets.map(target => target.documentId)).size !== request.targets.length) {
        throw new ImageStorageError(422, 'Each product may appear only once in an image assignment.');
    }
    const profileRef = db.collection('USER_PROFILE').doc(profileId);
    requireProductOutlet(profileId, outletId, (await profileRef.get()).data(), assigned);
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(request.base64)) {
        throw new ImageStorageError(415, 'The image encoding is invalid.');
    }
    const bytes = Buffer.from(request.base64, 'base64');
    if (!bytes.length || bytes.length > PRODUCT_IMAGE_MAX_BYTES)
        throw new ImageStorageError(413, 'Product images must be 512 KB or smaller.');
    const contentType = detectImage(bytes);
    if (contentType !== request.contentType)
        throw new ImageStorageError(415, 'The image content does not match its declared file type.');
    const digest = createHash('sha256').update(bytes).digest('hex');
    const name = createHash('sha256').update(JSON.stringify(['product-image-assignment-v1', outletId, profileId, request.requestId, digest])).digest('hex');
    const extension = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';
    const image = `${name}.${extension}`;
    await storeVerifiedProductImage(bucket, image, bytes, contentType);
    const results = [];
    for (const target of request.targets) {
        try {
            const status = await db.runTransaction(async (transaction) => {
                const profile = (await transaction.get(profileRef)).data();
                requireProductOutlet(profileId, outletId, profile, assigned);
                const productRef = db.collection('OUTLET').doc(outletId).collection('PRODUCT').doc(target.documentId);
                const current = await transaction.get(productRef);
                if (!current.exists)
                    throw new ImageStorageError(404, 'This product no longer exists in this outlet.');
                const currentImage = reference(current.get('image'));
                const currentPath = reference(current.get('imagePath'));
                if (currentImage === image)
                    return 'unchanged';
                if (currentImage !== target.expectedImage || currentPath !== target.expectedImagePath) {
                    throw new ImageStorageError(409, 'The saved image changed since review. Reload products and review this replacement again.');
                }
                if ((currentImage || currentPath) && !target.replaceExisting) {
                    throw new ImageStorageError(409, 'Confirm replacement of the existing image first.');
                }
                // Keep legacy fields and all other product values exactly as stored.
                transaction.update(productRef, { image });
                return 'saved';
            });
            results.push({ documentId: target.documentId, status, message: status === 'saved' ? 'Image saved.' : 'Already saved; verified current reference.' });
        }
        catch (error) {
            results.push({ documentId: target.documentId, status: 'failed', message: error instanceof ImageStorageError
                    ? error.message : 'The update could not be confirmed. Retry to check the current reference safely.' });
        }
    }
    // Never delete the object on partial failure: successful or uncertain writes may reference it.
    return { image, results };
}
//# sourceMappingURL=productImageAssignments.js.map