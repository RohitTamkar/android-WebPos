import { createHash } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { Timestamp } from 'firebase-admin/firestore';
import { z } from 'zod';
import { ProductCreationError, newProductSchema, productTaxes, requireProductOutlet, validateProductReferences } from './productCreation.js';
import { productFields } from './productDefaults.js';
import { nextProductCode } from './productImportValidation.js';
import { getFirebaseStorageBucket } from './firebase.js';
import { copyMasterImageFromPath, ImageStorageError, isMasterImagePath, productImageStoragePath, resolveProductImagePath, verifyExistingProductImage, verifyMasterImageCopy } from './imageStorage.js';
const audience = 'pos-master-transfer';
function requireSigningKey(secret) {
    if (Buffer.byteLength(secret, 'utf8') < 32)
        throw new ProductCreationError(503, 'Transfer authorization is unavailable. Configure MASTER_TRANSFER_SECRET with at least 32 bytes on the server.');
}
const recordId = z.string().min(1).max(200).refine(value => !value.includes('/') && value !== '.' && value !== '..');
const copyFields = z.enum(['name', 'regionalName', 'shortName', 'category', 'price', 'mrpPrice', 'costPrice', 'taxIndex', 'unitId', 'hsnCode', 'barcode', 'discount', 'stockable', 'weighable']);
const requestSchema = z.object({
    destinationOutletId: recordId, mode: z.enum(['categories', 'products']),
    categoryIds: z.array(recordId).max(100),
    products: z.array(z.object({ sourceProductId: recordId, fields: z.array(copyFields).min(1).max(14) }).strict()).max(100),
    categoryMappings: z.record(recordId, recordId),
}).strict();
const normalized = (value) => typeof value === 'string' ? value.trim().toLowerCase() : '';
const usableBarcode = (value) => typeof value === 'string' && value.trim() !== '0' ? value.trim() : '';
const destinationId = (type, sourceOutlet, sourceId, destination) => createHash('sha256').update(JSON.stringify(['master-transfer-v1', type, sourceOutlet, sourceId, destination])).digest('hex').slice(0, 32);
// The grant deliberately uses sub, not profileDocId: it cannot be used as a normal login token.
export function issueTransferAuthorization(secret, profileId, sourceOutletId, destinationOutletId) {
    requireSigningKey(secret);
    return jwt.sign({ sourceOutletId, destinationOutletId, purpose: 'master-transfer' }, secret, { subject: profileId, audience, expiresIn: '5m' });
}
export function requireTransferAuthorization(secret, grant, profileId, source, destination) {
    requireSigningKey(secret);
    try {
        const payload = jwt.verify(grant ?? '', secret, { audience, algorithms: ['HS256'] });
        if (typeof payload === 'string' || payload.sub !== profileId || payload.sourceOutletId !== source
            || payload.destinationOutletId !== destination || payload.purpose !== 'master-transfer')
            throw new Error();
    }
    catch {
        throw new ProductCreationError(403, 'QuickPin authorization expired or is invalid for these outlets. Verify your QuickPin again.');
    }
}
// Create-only master transfers. No source writes, destination updates, stock/history writes, or new schema fields.
async function transferOutletMastersUsingBucket(db, sourceId, profileId, assigned, secret, grant, raw, storageBucketProvider) {
    if (!profileId)
        throw new ProductCreationError(401, 'Your session has expired. Please sign in again.');
    const parsed = requestSchema.safeParse(raw);
    if (!recordId.safeParse(sourceId).success || !parsed.success)
        throw new ProductCreationError(422, 'Invalid transfer selection or unsupported fields.');
    const input = parsed.data;
    if (sourceId === input.destinationOutletId || input.categoryIds.length + input.products.length > 100
        || (input.mode === 'categories' && !input.categoryIds.length)
        || (input.mode === 'products' && !input.products.length)
        || new Set(input.categoryIds).size !== input.categoryIds.length
        || new Set(input.products.map(product => product.sourceProductId)).size !== input.products.length
        || input.products.some(product => new Set(product.fields).size !== product.fields.length)
        || Object.keys(input.categoryMappings).length > 100)
        throw new ProductCreationError(422, 'Select between 1 and 100 unique records for this transfer.');
    requireTransferAuthorization(secret, grant, profileId, sourceId, input.destinationOutletId);
    const source = db.collection('OUTLET').doc(sourceId);
    const destination = db.collection('OUTLET').doc(input.destinationOutletId);
    const planTransfer = async (transaction) => {
        requireTransferAuthorization(secret, grant, profileId, sourceId, input.destinationOutletId);
        const profile = (await transaction.get(db.collection('USER_PROFILE').doc(profileId))).data();
        requireProductOutlet(profileId, sourceId, profile, assigned);
        requireProductOutlet(profileId, input.destinationOutletId, profile, assigned);
        const outlets = await Promise.all([transaction.get(source), transaction.get(destination)]);
        if (outlets.some(outlet => !outlet.exists))
            throw new ProductCreationError(404, 'An outlet no longer exists.');
        const [sourceCategories, destCategories, destProducts, taxes] = await Promise.all([
            transaction.get(source.collection('CATEGORY')), transaction.get(destination.collection('CATEGORY')),
            transaction.get(destination.collection('PRODUCT')), transaction.get(db.collection('MASTERS').doc('masters').collection('TAX_MASTER')),
        ]);
        const sourceCategoryMap = new Map(sourceCategories.docs.map(doc => [doc.id, doc.data()]));
        const categoryMap = new Map(destCategories.docs.map(doc => [doc.id, doc.data()]));
        const productMap = new Map(destProducts.docs.map(doc => [doc.id, doc.data()]));
        const mappings = new Map();
        for (const [from, to] of Object.entries(input.categoryMappings)) {
            if (!sourceCategoryMap.has(from) || !categoryMap.has(to))
                throw new ProductCreationError(422, 'Category mappings must reference source and destination categories.');
            mappings.set(from, to);
        }
        const items = [];
        const plans = [];
        const sourceImageReferences = new Map();
        const existingImageChecks = [];
        const skip = (type, id, name, reason) => items.push({ type, sourceId: id, name, status: 'skipped', reason });
        for (const id of input.categoryIds) {
            const category = sourceCategoryMap.get(id);
            const name = typeof category?.name === 'string' ? category.name : id;
            if (!category) {
                skip('category', id, name, 'Source category no longer exists.');
                continue;
            }
            sourceImageReferences.set(`CATEGORY/${id}`, typeof category.imagePath === 'string' ? category.imagePath : null);
            if (mappings.has(id)) {
                items.push({ type: 'category', sourceId: id, name, status: 'mapped', destinationId: mappings.get(id), reason: 'Used the explicitly selected existing category; no record changed.' });
                continue;
            }
            const targetId = destinationId('category', sourceId, id, input.destinationOutletId);
            if (categoryMap.has(targetId)) {
                mappings.set(id, targetId);
                if (typeof category.imagePath === 'string')
                    existingImageChecks.push({ type: 'category', sourceId: id,
                        sourceImagePath: category.imagePath, destinationImagePath: categoryMap.get(targetId)?.imagePath,
                        destinationOutletId: input.destinationOutletId, destinationDocumentId: targetId });
                items.push({ type: 'category', sourceId: id, name, status: 'already-transferred', destinationId: targetId, reason: 'Previously transferred category retained; no fields overwritten.' });
                continue;
            }
            const valid = z.object({ name: z.string().trim().min(1).max(200), categoryNo: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
                regionalName: z.string().max(200).default(''), dayType: z.string().max(100).default('') }).safeParse({
                name: category.name, categoryNo: [...categoryMap.values()].reduce((highest, target) => {
                    const value = Number(target.categoryNo);
                    return Number.isSafeInteger(value) && value > highest ? value : highest;
                }, 0) + 1, regionalName: category.regionalName ?? '', dayType: category.dayType ?? '',
            });
            if (!valid.success) {
                skip('category', id, name, 'Source category fields are not supported by the existing category model.');
                continue;
            }
            if ([...categoryMap.values()].some(target => normalized(target.name) === normalized(valid.data.name))) {
                skip('category', id, name, 'A category with this name already exists. Existing category retained; no duplicate created. Select it as the destination category when copying products.');
                continue;
            }
            const fields = { ...valid.data, id: targetId, onlineSynced: false, selected: false };
            const imagePath = typeof category.imagePath === 'string' ? category.imagePath : undefined;
            if (imagePath && !isMasterImagePath(imagePath, 'categories', sourceId, id)) {
                skip('category', id, name, 'Source image reference is invalid; no destination record was created.');
                continue;
            }
            plans.push({ collection: 'CATEGORY', id: targetId, fields, sourceId: id, name, ...(imagePath ? { sourceImagePath: imagePath } : {}) });
            categoryMap.set(targetId, fields);
            mappings.set(id, targetId);
            items.push({ type: 'category', sourceId: id, name, status: 'created', destinationId: targetId, destinationNumber: valid.data.categoryNo, reason: 'Category copied.' });
        }
        for (const selection of input.products) {
            const id = selection.sourceProductId;
            const document = await transaction.get(source.collection('PRODUCT').doc(id));
            const product = document.data();
            const name = typeof product?.name === 'string' ? product.name : id;
            if (!document.exists || !product) {
                skip('product', id, name, 'Source product no longer exists.');
                continue;
            }
            sourceImageReferences.set(`PRODUCT/${id}`, JSON.stringify([product.imagePath ?? null, product.image ?? null]));
            const filenamePath = productImageStoragePath(product.image);
            const imagePath = resolveProductImagePath(product, sourceId, id);
            // Never silently drop an unsupported image value or replace an invalid Web path
            // with a different image. These records need review before a safe transfer.
            if (!imagePath && ((product.image != null && product.image !== '') || (product.imagePath != null && product.imagePath !== ''))) {
                skip('product', id, name, 'Source image reference is invalid or unsupported; no destination record was created.');
                continue;
            }
            const targetId = destinationId('product', sourceId, id, input.destinationOutletId);
            if (productMap.has(targetId)) {
                if (imagePath)
                    existingImageChecks.push({ type: 'product', sourceId: id,
                        sourceImagePath: imagePath, destinationImagePath: resolveProductImagePath(productMap.get(targetId), input.destinationOutletId, targetId),
                        destinationOutletId: input.destinationOutletId, destinationDocumentId: targetId,
                        ...(filenamePath ? { sourceProductImage: product.image, destinationProductImage: productMap.get(targetId)?.image } : {}) });
                items.push({ type: 'product', sourceId: id, name, status: 'already-transferred', destinationId: targetId, reason: 'Previously transferred product retained. Existing fields and stock were not changed.' });
                continue;
            }
            if (!['name', 'category', 'taxIndex', 'unitId'].every(field => selection.fields.includes(field))) {
                skip('product', id, name, 'New products require Product Name, Category, Tax Index and Unit ID selections.');
                continue;
            }
            const mappedCategory = typeof product.category === 'string' ? mappings.get(product.category) : undefined;
            if (!mappedCategory || !categoryMap.has(mappedCategory)) {
                skip('product', id, name, 'Select a valid destination category or transfer the required category.');
                continue;
            }
            if (selection.fields.some(field => field !== 'category' && (product[field] === undefined || product[field] === null))) {
                skip('product', id, name, 'A selected source field is unavailable.');
                continue;
            }
            if (selection.fields.includes('price')) {
                let defaultPrice;
                try {
                    defaultPrice = JSON.parse(String(product.priceTable))?.['default price'];
                }
                catch {
                    defaultPrice = undefined;
                }
                if (defaultPrice !== product.price) {
                    skip('product', id, name, 'Selling Price and the existing default price table must agree; separate price mappings are unsupported.');
                    continue;
                }
            }
            const candidate = { name: '', regionalName: '', shortName: '', category: mappedCategory, price: 0, mrpPrice: 0,
                costPrice: 0, taxIndex: -1, unitId: -1, hsnCode: '', discount: 0, stockable: false, weighable: false };
            for (const field of selection.fields)
                if (field !== 'category' && field !== 'barcode')
                    candidate[field] = product[field];
            const valid = newProductSchema.omit({ requestId: true, code: true }).safeParse(candidate);
            if (!valid.success) {
                skip('product', id, name, 'A selected source field is missing or invalid.');
                continue;
            }
            try {
                validateProductReferences(valid.data, [...categoryMap.keys()], productTaxes(taxes.docs.map(doc => doc.data())));
            }
            catch {
                skip('product', id, name, 'Destination category, tax or unit reference is invalid.');
                continue;
            }
            let barcode = '';
            if (selection.fields.includes('barcode')) {
                if (typeof product.barcode !== 'string' || product.barcode.length > 200) {
                    skip('product', id, name, 'Selected barcode is missing or invalid.');
                    continue;
                }
                barcode = product.barcode;
            }
            // Name/barcode collisions are only warnings of possible identity: skip, never merge or overwrite.
            if ([...productMap.values()].some(target => normalized(target.name) === normalized(valid.data.name)
                || (!!usableBarcode(product.barcode) && usableBarcode(target.barcode) === usableBarcode(product.barcode)))) {
                skip('product', id, name, 'Possible destination name or barcode conflict. Existing product and stock preserved.');
                continue;
            }
            const code = nextProductCode([...productMap].map(([productId, fields]) => ({ id: productId, fields })));
            const fields = { ...productFields(valid.data, code, barcode), id: targetId, dateTme: Timestamp.now() };
            plans.push({ collection: 'PRODUCT', id: targetId, fields, sourceId: id, name,
                ...(imagePath ? { sourceImagePath: imagePath } : {}),
                ...(filenamePath ? { sourceProductImage: product.image } : {}), destinationCategoryId: mappedCategory });
            productMap.set(targetId, fields);
            items.push({ type: 'product', sourceId: id, name, status: 'created', destinationId: targetId, destinationNumber: code, reason: 'Product copied with zero stock.' });
        }
        return { items, plans, sourceImageReferences, existingImageChecks };
    };
    const preflight = await db.runTransaction(planTransfer);
    const fingerprint = (result) => JSON.stringify({
        items: result.items.map(({ type, sourceId, status, destinationId }) => [type, sourceId, status, destinationId]),
        plans: result.plans.map(({ collection, id, sourceId, sourceImagePath, sourceProductImage, destinationCategoryId }) => [collection, id, sourceId, sourceImagePath ?? null, sourceProductImage ?? null, destinationCategoryId ?? null]),
        checks: result.existingImageChecks,
        refs: [...result.sourceImageReferences].sort(([a], [b]) => a.localeCompare(b)),
    });
    const expected = fingerprint(preflight);
    const needsStorage = preflight.plans.some(plan => !!plan.sourceImagePath) || preflight.existingImageChecks.length > 0;
    const bucket = needsStorage ? storageBucketProvider() : undefined;
    const failedCategories = new Set();
    const blockedPlans = new Set();
    const outcomeOverrides = new Map();
    const itemKey = (type, id) => `${type}/${id}`;
    for (const check of preflight.existingImageChecks) {
        const sharedFilenameOnly = check.sourceProductImage !== undefined
            && check.sourceImagePath === productImageStoragePath(check.sourceProductImage)
            && check.destinationImagePath === productImageStoragePath(check.sourceProductImage);
        let valid = sharedFilenameOnly
            ? check.destinationProductImage === check.sourceProductImage && await verifyExistingProductImage(bucket, check.sourceProductImage)
            : await verifyMasterImageCopy(bucket, check.type === 'product' ? 'products' : 'categories', sourceId, check.sourceId, check.sourceImagePath, check.destinationOutletId, check.destinationDocumentId, check.destinationImagePath);
        if (valid && check.sourceProductImage !== undefined && !sharedFilenameOnly) {
            const filenamePath = productImageStoragePath(check.sourceProductImage);
            valid = check.destinationProductImage === check.sourceProductImage && !!filenamePath
                && await verifyMasterImageCopy(bucket, 'products', sourceId, check.sourceId, filenamePath, check.destinationOutletId, check.destinationDocumentId, check.destinationImagePath);
        }
        if (!valid) {
            const item = preflight.items.find(value => value.type === check.type && value.sourceId === check.sourceId);
            item.status = 'skipped';
            item.reason = 'Existing destination image is missing or differs from the source; record left unchanged.';
            outcomeOverrides.set(itemKey(check.type, check.sourceId), item.reason);
            if (check.type === 'category')
                failedCategories.add(item.destinationId ?? '');
        }
    }
    const imagePaths = new Map();
    const verifiedSharedImages = new Set();
    for (const plan of preflight.plans) {
        if (!plan.sourceImagePath)
            continue;
        if (plan.collection === 'PRODUCT' && failedCategories.has(plan.destinationCategoryId ?? '')) {
            const item = preflight.items.find(value => value.sourceId === plan.sourceId && value.type === 'product');
            item.status = 'skipped';
            item.reason = 'The destination category image could not be verified; dependent product was not created.';
            blockedPlans.add(`${plan.collection}/${plan.id}`);
            outcomeOverrides.set(itemKey('product', plan.sourceId), item.reason);
            continue;
        }
        try {
            if (plan.sourceProductImage && plan.sourceImagePath === productImageStoragePath(plan.sourceProductImage)) {
                if (!await verifyExistingProductImage(bucket, plan.sourceProductImage)) {
                    throw new ImageStorageError(404, 'The existing product image could not be verified in the configured bucket; no destination record was created.');
                }
                // The global object already exists and is shared without modification. The
                // authenticated reader can resolve it for the destination without a duplicate upload.
                verifiedSharedImages.add(`${plan.collection}/${plan.id}`);
                continue;
            }
            const copied = await copyMasterImageFromPath(bucket, plan.collection === 'PRODUCT' ? 'products' : 'categories', sourceId, plan.sourceId, plan.sourceImagePath, input.destinationOutletId, plan.id);
            if (plan.sourceProductImage && !await verifyMasterImageCopy(bucket, 'products', sourceId, plan.sourceId, productImageStoragePath(plan.sourceProductImage), input.destinationOutletId, plan.id, copied.imagePath)) {
                throw new ImageStorageError(409, 'The existing image and imagePath do not resolve to matching verified bytes; no destination record was created.');
            }
            imagePaths.set(`${plan.collection}/${plan.id}`, copied.imagePath);
        }
        catch (error) {
            const item = preflight.items.find(value => value.sourceId === plan.sourceId
                && value.type === (plan.collection === 'PRODUCT' ? 'product' : 'category'));
            item.status = 'skipped';
            item.reason = error instanceof Error ? error.message : 'Image copy failed; retry the transfer.';
            outcomeOverrides.set(itemKey(item.type, item.sourceId), item.reason);
            if (plan.collection === 'CATEGORY')
                failedCategories.add(plan.id);
        }
    }
    for (const plan of preflight.plans.filter(value => value.collection === 'PRODUCT' && failedCategories.has(value.destinationCategoryId ?? ''))) {
        const item = preflight.items.find(value => value.type === 'product' && value.sourceId === plan.sourceId);
        item.status = 'skipped';
        item.reason = 'The destination category image could not be copied; dependent product was not created.';
        blockedPlans.add(`${plan.collection}/${plan.id}`);
        outcomeOverrides.set(itemKey('product', plan.sourceId), item.reason);
        imagePaths.delete(`${plan.collection}/${plan.id}`);
    }
    // Storage copies are immutable and deterministic. If Firestore commit fails, retain them:
    // deleting here could race with another successful transaction that references the same object.
    return db.runTransaction(async (transaction) => {
        const current = await planTransfer(transaction);
        if (fingerprint(current) !== expected)
            throw new ProductCreationError(409, 'Transfer data changed while images were being copied. Review and retry the transfer.');
        for (const item of current.items) {
            const reason = outcomeOverrides.get(itemKey(item.type, item.sourceId));
            if (reason) {
                item.status = 'skipped';
                item.reason = reason;
            }
        }
        for (const plan of current.plans) {
            const key = `${plan.collection}/${plan.id}`;
            const item = current.items.find(value => value.sourceId === plan.sourceId
                && value.type === (plan.collection === 'PRODUCT' ? 'product' : 'category'));
            if (item.status !== 'created' || blockedPlans.has(key))
                continue;
            const imagePath = imagePaths.get(key);
            if (plan.sourceImagePath && !imagePath && !verifiedSharedImages.has(key)) {
                item.status = 'skipped';
                item.reason = 'Image copy did not complete; no destination record was created.';
                continue;
            }
            if (imagePath) {
                if (plan.collection === 'PRODUCT')
                    plan.fields.image = imagePath.slice('product_images/'.length);
                else
                    plan.fields.imagePath = imagePath;
            }
            // Retain an existing shared filename only after verification; never modify
            // the shared Storage object when creating another product reference.
            if ((imagePath || verifiedSharedImages.has(key)) && plan.sourceProductImage)
                plan.fields.image = plan.sourceProductImage;
            transaction.create(destination.collection(plan.collection).doc(plan.id), plan.fields);
        }
        return { items: current.items, created: current.items.filter(item => item.status === 'created').length,
            skipped: current.items.filter(item => item.status === 'skipped').length,
            unchanged: current.items.filter(item => item.status === 'already-transferred' || item.status === 'mapped').length };
    });
}
export async function transferOutletMasters(db, sourceId, profileId, assigned, secret, grant, raw) {
    return transferOutletMastersUsingBucket(db, sourceId, profileId, assigned, secret, grant, raw, getFirebaseStorageBucket);
}
// Injectable Storage seam for isolated tests; the HTTP route continues using transferOutletMasters.
export async function transferOutletMastersWithStorage(db, sourceId, profileId, assigned, secret, grant, raw, bucket) {
    return transferOutletMastersUsingBucket(db, sourceId, profileId, assigned, secret, grant, raw, () => bucket);
}
//# sourceMappingURL=masterTransfer.js.map