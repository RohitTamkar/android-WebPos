"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ImageStorageError = exports.PRODUCT_IMAGE_MAX_BYTES = void 0;
exports.detectImage = detectImage;
exports.isMasterImagePath = isMasterImagePath;
exports.productImageStoragePath = productImageStoragePath;
exports.resolveProductImagePath = resolveProductImagePath;
exports.verifyStorageCopy = verifyStorageCopy;
exports.verifyExistingProductImage = verifyExistingProductImage;
exports.copyMasterImageFromPath = copyMasterImageFromPath;
exports.verifyMasterImageCopy = verifyMasterImageCopy;
exports.storeVerifiedProductImage = storeVerifiedProductImage;
exports.uploadMasterImage = uploadMasterImage;
exports.readMasterImage = readMasterImage;
exports.copyMasterImage = copyMasterImage;
exports.removeMasterImage = removeMasterImage;
const node_crypto_1 = require("node:crypto");
const firestore_1 = require("firebase-admin/firestore");
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
exports.PRODUCT_IMAGE_MAX_BYTES = 30 * 1024;
const mimeExtension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
class ImageStorageError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
exports.ImageStorageError = ImageStorageError;
function validateRecordIds(outletId, documentId) {
    for (const id of [outletId, documentId]) {
        if (!id || id.length > 200 || id.includes('/') || id === '.' || id === '..') {
            throw new ImageStorageError(400, 'A valid outlet and record ID are required.');
        }
    }
}
function detectImage(bytes) {
    if (bytes.length > MAX_IMAGE_BYTES)
        throw new ImageStorageError(413, 'Images must be 5 MB or smaller.');
    if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
        return 'image/png';
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
        return 'image/jpeg';
    if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP')
        return 'image/webp';
    throw new ImageStorageError(415, 'Use a valid JPEG, PNG, or WebP image.');
}
async function fetchImageBytes(url) {
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000), cache: 'no-store' });
    if (!response.ok || !response.body) {
        await response.body?.cancel().catch(() => undefined);
        throw new Error('Image download failed.');
    }
    const contentLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) {
        await response.body.cancel().catch(() => undefined);
        throw new ImageStorageError(413, 'Images must be 5 MB or smaller.');
    }
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            size += value.byteLength;
            if (size > MAX_IMAGE_BYTES) {
                await reader.cancel();
                throw new ImageStorageError(413, 'Images must be 5 MB or smaller.');
            }
            chunks.push(Buffer.from(value));
        }
    }
    finally {
        reader.releaseLock();
    }
    return Buffer.concat(chunks, size);
}
function expectedPath(kind, outletId, documentId) {
    return `sensible_images/OUTLET/${outletId}/${kind === 'products' ? 'PRODUCT' : 'CATEGORY'}_IMAGES/${documentId}/`;
}
function isExpectedPath(path, prefix) {
    if (!path.startsWith(prefix))
        return false;
    const suffix = path.slice(prefix.length);
    return new RegExp('^[a-f0-9-]+\\.(?:jpg|png|webp)$').exec(suffix)?.[0] === suffix;
}
function isMasterImagePath(path, kind, outletId, documentId) {
    return typeof path === 'string' && isExpectedPath(path, expectedPath(kind, outletId, documentId));
}
// Product documents store a filename; the authenticated backend resolves it in the
// configured bucket. Scoped Web POS paths remain supported for legacy records.
function productImageStoragePath(image) {
    return typeof image === 'string' && /^[a-z0-9][a-z0-9_-]{0,199}\.(?:png|jpe?g|webp)$/i.exec(image)?.[0] === image
        ? `product_images/${image}` : undefined;
}
function resolveProductImagePath(fields, outletId, documentId) {
    const image = fields.image;
    if (image !== undefined && image !== null && image !== '') {
        return isMasterImagePath(image, 'products', outletId, documentId) ? image : productImageStoragePath(image);
    }
    return isMasterImagePath(fields.imagePath, 'products', outletId, documentId) ? fields.imagePath : undefined;
}
function isReadableImagePath(path, kind, outletId, documentId) {
    return isMasterImagePath(path, kind, outletId, documentId)
        || (kind === 'products' && typeof path === 'string' && path.startsWith('product_images/')
            && productImageStoragePath(path.slice('product_images/'.length)) === path);
}
async function readStorageImage(bucket, imagePath) {
    const [url] = await bucket.file(imagePath).getSignedUrl({ action: 'read', expires: Date.now() + 60_000 });
    const bytes = await fetchImageBytes(url);
    return { bytes, contentType: detectImage(bytes) };
}
function masterImageCopyPath(kind, sourceOutletId, sourceDocumentId, sourceImagePath, destinationOutletId, destinationDocumentId, contentType) {
    const imageId = (0, node_crypto_1.createHash)('sha256').update(JSON.stringify([
        'master-image-transfer-v1', kind, sourceOutletId, sourceDocumentId,
        destinationOutletId, destinationDocumentId, sourceImagePath,
    ])).digest('hex');
    const prefix = kind === 'products' ? 'product_images/' : expectedPath(kind, destinationOutletId, destinationDocumentId);
    return `${prefix}${imageId}.${mimeExtension[contentType]}`;
}
function isPreconditionFailure(error) {
    if (!error || typeof error !== 'object')
        return false;
    const value = error;
    return value.code === 412 || value.statusCode === 412;
}
async function verifyStorageCopy(bucket, imagePath, expectedBytes, expectedType) {
    try {
        const [metadata] = await bucket.file(imagePath).getMetadata();
        if (metadata.contentType !== expectedType || Number(metadata.size) !== expectedBytes.length)
            return false;
        const existing = await readStorageImage(bucket, imagePath);
        return existing.contentType === expectedType && existing.bytes.equals(expectedBytes);
    }
    catch {
        return false;
    }
}
async function verifyExistingProductImage(bucket, image) {
    const path = productImageStoragePath(image);
    if (!path)
        return false;
    try {
        const stored = await readStorageImage(bucket, path);
        return await verifyStorageCopy(bucket, path, stored.bytes, stored.contentType);
    }
    catch {
        return false;
    }
}
// Copies one already-validated source reference without overwriting a destination object.
async function copyMasterImageFromPath(bucket, kind, sourceOutletId, sourceDocumentId, sourceImagePath, destinationOutletId, destinationDocumentId) {
    validateRecordIds(sourceOutletId, sourceDocumentId);
    validateRecordIds(destinationOutletId, destinationDocumentId);
    if (!isReadableImagePath(sourceImagePath, kind, sourceOutletId, sourceDocumentId)) {
        throw new ImageStorageError(422, 'The source image reference is invalid for this record.');
    }
    let source;
    try {
        source = await readStorageImage(bucket, sourceImagePath);
    }
    catch (error) {
        if (error instanceof ImageStorageError)
            throw error;
        throw new ImageStorageError(404, 'The source image is unavailable.');
    }
    const destinationImagePath = masterImageCopyPath(kind, sourceOutletId, sourceDocumentId, sourceImagePath, destinationOutletId, destinationDocumentId, source.contentType);
    const destinationFile = bucket.file(destinationImagePath);
    try {
        await destinationFile.save(source.bytes, { resumable: false, preconditionOpts: { ifGenerationMatch: 0 },
            metadata: { contentType: source.contentType, cacheControl: 'private, no-store' } });
    }
    catch (error) {
        if (!isPreconditionFailure(error)) {
            throw new ImageStorageError(503, 'The destination image could not be copied safely. Retry the transfer.');
        }
        // Another attempt may have created the same deterministic object. Reuse it only after
        // checking the stored metadata and bytes; never overwrite a mismatching object.
    }
    if (!await verifyStorageCopy(bucket, destinationImagePath, source.bytes, source.contentType)) {
        throw new ImageStorageError(409, 'A conflicting destination image exists and was not changed.');
    }
    return { imagePath: destinationImagePath, sourceImagePath, contentType: source.contentType };
}
async function verifyMasterImageCopy(bucket, kind, sourceOutletId, sourceDocumentId, sourceImagePath, destinationOutletId, destinationDocumentId, destinationImagePath) {
    if (!isReadableImagePath(sourceImagePath, kind, sourceOutletId, sourceDocumentId)
        || !isReadableImagePath(destinationImagePath, kind, destinationOutletId, destinationDocumentId))
        return false;
    try {
        const source = await readStorageImage(bucket, sourceImagePath);
        return await verifyStorageCopy(bucket, destinationImagePath, source.bytes, source.contentType);
    }
    catch {
        return false;
    }
}
function reference(db, outletId, collection, documentId) {
    return db.collection('OUTLET').doc(outletId).collection(collection).doc(documentId);
}
async function storeVerifiedProductImage(bucket, filename, bytes, contentType) {
    const path = productImageStoragePath(filename);
    if (!path)
        throw new ImageStorageError(400, 'Invalid generated image filename.');
    const object = bucket.file(path);
    let exists = false;
    try {
        await object.getMetadata();
        exists = true;
    }
    catch (error) {
        if (error.code !== 404)
            throw new ImageStorageError(503, 'Unable to check the image in Storage. Retry this operation.');
    }
    if (!exists) {
        try {
            await object.save(bytes, { resumable: false, preconditionOpts: { ifGenerationMatch: 0 },
                metadata: { contentType, cacheControl: 'private, no-store' } });
        }
        catch { /* A concurrent retry or lost response is resolved by exact verification below. */ }
    }
    if (!await verifyStorageCopy(bucket, path, bytes, contentType)) {
        throw new ImageStorageError(503, 'The uploaded image could not be verified. Product references were not changed. Retry this operation.');
    }
}
async function uploadMasterImage(db, bucket, kind, outletId, documentId, bytes, declaredType, operation) {
    validateRecordIds(outletId, documentId);
    if (!Buffer.isBuffer(bytes) || !bytes.length)
        throw new ImageStorageError(400, 'Choose an image before uploading.');
    if (kind === 'products' && bytes.length > exports.PRODUCT_IMAGE_MAX_BYTES)
        throw new ImageStorageError(413, 'Product images must be 30 KB or smaller.');
    const detectedType = detectImage(bytes);
    if (declaredType !== detectedType)
        throw new ImageStorageError(415, 'The image content does not match its declared file type.');
    const collection = kind === 'products' ? 'PRODUCT' : 'CATEGORY';
    const documentRef = reference(db, outletId, collection, documentId);
    const existing = await documentRef.get();
    if (!existing.exists)
        throw new ImageStorageError(404, 'This record no longer exists.');
    if (operation && (kind !== 'products' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(operation.requestId)
        || (operation.expectedReference !== null && (typeof operation.expectedReference !== 'string' || operation.expectedReference.length > 600)))) {
        throw new ImageStorageError(400, 'Invalid image upload operation.');
    }
    const name = operation ? (0, node_crypto_1.createHash)('sha256').update(JSON.stringify(['single-product-image-v1', outletId, documentId,
        operation.requestId, (0, node_crypto_1.createHash)('sha256').update(bytes).digest('hex')])).digest('hex') : (0, node_crypto_1.randomUUID)();
    const filename = `${name}.${mimeExtension[detectedType]}`;
    if (operation) {
        const checkReference = (snapshot) => {
            if (!snapshot.exists)
                throw new ImageStorageError(404, 'This record no longer exists.');
            if (snapshot.get('image') === filename)
                return true;
            const current = snapshot.get('image') || snapshot.get('imagePath') || null;
            if (current !== operation.expectedReference)
                throw new ImageStorageError(409, 'The saved image changed. Reload the product and review the replacement again.');
            return false;
        };
        checkReference(existing);
        await storeVerifiedProductImage(bucket, filename, bytes, detectedType);
        try {
            await db.runTransaction(async (transaction) => {
                const current = await transaction.get(documentRef);
                if (!checkReference(current))
                    transaction.update(documentRef, { image: filename });
            });
        }
        catch (error) {
            if (error instanceof ImageStorageError)
                throw error;
            throw new ImageStorageError(503, 'The image save could not be confirmed. Retry to verify its current reference.');
        }
        return { image: filename };
    }
    const imagePath = kind === 'products' ? productImageStoragePath(filename) : `${expectedPath(kind, outletId, documentId)}${filename}`;
    const object = bucket.file(imagePath);
    try {
        await object.save(bytes, { resumable: false, preconditionOpts: { ifGenerationMatch: 0 },
            metadata: { contentType: detectedType, cacheControl: 'private, no-store' } });
    }
    catch {
        throw new ImageStorageError(503, 'Firebase Storage could not accept the upload. Check the bucket name and backend service account permissions.');
    }
    // A successful upload response alone does not prove the object contains the expected
    // bytes. Keep the previous reference until both metadata and downloaded content match.
    if (!await verifyStorageCopy(bucket, imagePath, bytes, detectedType)) {
        throw new ImageStorageError(503, 'The uploaded image could not be verified. The saved image reference was not changed. Retry the upload.');
    }
    try {
        await documentRef.update(kind === 'products'
            ? { image: filename, ...(existing.get('imagePath') !== undefined ? { imagePath: firestore_1.FieldValue.delete() } : {}) }
            : { imagePath });
    }
    catch {
        // The Firestore write outcome may be uncertain after a network failure; keep the new object
        // so a committed reference can never point to an object deleted by this cleanup path.
        throw new ImageStorageError(503, 'The image save could not be confirmed. Reload the record before retrying.');
    }
    return kind === 'products' ? { image: filename } : { imagePath };
}
async function readMasterImage(db, bucket, kind, outletId, documentId, authorizedSnapshot) {
    validateRecordIds(outletId, documentId);
    const collection = kind === 'products' ? 'PRODUCT' : 'CATEGORY';
    const snapshot = authorizedSnapshot ?? await reference(db, outletId, collection, documentId).get();
    if (!snapshot.exists)
        throw new ImageStorageError(404, 'This record no longer exists.');
    const storedPath = snapshot.get('imagePath');
    // An active image must not fall back to a stale legacy reference if it is invalid
    // or unavailable. Only image-free legacy records use imagePath.
    const imagePath = kind === 'products'
        ? resolveProductImagePath({ image: snapshot.get('image'), imagePath: storedPath }, outletId, documentId)
        : isMasterImagePath(storedPath, kind, outletId, documentId) ? storedPath : undefined;
    if (!imagePath) {
        throw new ImageStorageError(404, 'No saved image is available for this record.');
    }
    try {
        return { ...await readStorageImage(bucket, imagePath), imagePath };
    }
    catch (error) {
        if (error instanceof ImageStorageError)
            throw error;
        throw new ImageStorageError(404, 'The saved image is unavailable.');
    }
}
async function copyMasterImage(db, bucket, kind, sourceOutletId, sourceDocumentId, destinationOutletId, destinationDocumentId) {
    const source = await readMasterImage(db, bucket, kind, sourceOutletId, sourceDocumentId);
    return (await copyMasterImageFromPath(bucket, kind, sourceOutletId, sourceDocumentId, source.imagePath, destinationOutletId, destinationDocumentId)).imagePath;
}
async function removeMasterImage(db, kind, outletId, documentId, reviewed) {
    validateRecordIds(outletId, documentId);
    const collection = kind === 'products' ? 'PRODUCT' : 'CATEGORY';
    const documentRef = reference(db, outletId, collection, documentId);
    if (reviewed !== undefined) {
        if (kind !== 'products' || !reviewed || typeof reviewed !== 'object' || Array.isArray(reviewed)
            || Object.keys(reviewed).sort().join() !== 'image,imagePath')
            throw new ImageStorageError(400, 'Invalid reviewed image references.');
        const expected = reviewed;
        if ([expected.image, expected.imagePath].some(value => value !== null && (typeof value !== 'string' || value.length > 600))) {
            throw new ImageStorageError(400, 'Invalid reviewed image references.');
        }
        await db.runTransaction(async (transaction) => {
            const current = await transaction.get(documentRef);
            if (!current.exists)
                throw new ImageStorageError(404, 'This record no longer exists.');
            const image = current.get('image') || null, imagePath = current.get('imagePath') || null;
            if (!image && !imagePath)
                return; // A retry after an uncertain commit is already complete.
            if (image !== expected.image || imagePath !== expected.imagePath) {
                throw new ImageStorageError(409, 'The product image changed after confirmation. Review it again before removing it.');
            }
            const changes = {};
            if (typeof current.get('image') === 'string')
                changes.image = null;
            if (typeof current.get('imagePath') === 'string')
                changes.imagePath = firestore_1.FieldValue.delete();
            if (Object.keys(changes).length)
                transaction.update(documentRef, changes);
        });
        return { removed: true };
    }
    const snapshot = await documentRef.get();
    if (!snapshot.exists)
        throw new ImageStorageError(404, 'This record no longer exists.');
    const changes = {};
    if (typeof snapshot.get('imagePath') === 'string')
        changes.imagePath = firestore_1.FieldValue.delete();
    if (kind === 'products' && typeof snapshot.get('image') === 'string')
        changes.image = null;
    if (Object.keys(changes).length)
        await documentRef.update(changes);
    // Storage cleanup is deferred. This avoids deleting a file that another record may reference.
    return { removed: true };
}
//# sourceMappingURL=imageStorage.js.map