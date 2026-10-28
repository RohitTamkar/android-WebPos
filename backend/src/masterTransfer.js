import { createHash } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { Timestamp } from 'firebase-admin/firestore';
import { z } from 'zod';
import { ProductCreationError, newProductSchema, requireProductOutlet } from './productCreation.js';
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
    // Optional so older clients keep the original behavior: images copied, other data not added.
    options: z.object({ stock: z.boolean(), weighable: z.boolean(), images: z.boolean(), taxes: z.boolean(), prices: z.boolean(), barcode: z.boolean().default(false) }).strict()
        .default({ stock: false, weighable: false, images: true, taxes: false, prices: false, barcode: false }),
}).strict();
const finiteNumber = (value, max = 1e9) => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= max;
const premiseName = (value) => value.trim().replace(/\s+/g, ' ').toLowerCase();
// Data added on top of the selected fields. Each value is copied only when it is valid in the source.
function optionalProductData(product, options, destinationPremises) {
    const fields = [], extra = {}, candidate = {}, notes = [];
    if (options.weighable && typeof product.weighable === 'boolean')
        fields.push('weighable');
    if (options.barcode && typeof product.barcode === 'string' && product.barcode.length <= 200)
        fields.push('barcode');
    if (options.stock) {
        if (typeof product.stockable === 'boolean')
            fields.push('stockable');
        if (finiteNumber(product.currentStock))
            extra.currentStock = product.currentStock;
        else
            notes.push('source stock unavailable, so stock starts at 0');
    }
    if (options.taxes) {
        if (typeof product.hsnCode === 'string')
            fields.push('hsnCode');
        if (finiteNumber(product.cess) && product.cess >= 0)
            extra.cess = product.cess;
    }
    if (options.prices) {
        for (const key of ['price', 'mrpPrice', 'costPrice'])
            if (finiteNumber(product[key]) && product[key] >= 0)
                fields.push(key);
        for (const key of ['wholeSaleAmount', 'onlinePrice'])
            if (finiteNumber(product[key]) && product[key] >= 0)
                candidate[key] = product[key];
        let table;
        try {
            table = typeof product.priceTable === 'string' ? JSON.parse(product.priceTable) : product.priceTable;
        }
        catch {
            table = null;
        }
        const premisePrices = {}, dropped = [];
        if (table && typeof table === 'object' && !Array.isArray(table)) {
            for (const [key, value] of Object.entries(table)) {
                if (premiseName(key) === 'default price')
                    continue;
                const name = premiseName(key.replace(/\s+price$/i, ''));
                // Premises are outlet-specific: copy a premises price only when the destination has that premises.
                if (finiteNumber(value) && value >= 0 && (destinationPremises.has(name) || destinationPremises.has(premiseName(key))))
                    premisePrices[key] = value;
                else
                    dropped.push(key);
            }
        }
        if (Object.keys(premisePrices).length)
            extra.premisePrices = premisePrices;
        if (dropped.length)
            notes.push(`premises prices not copied (no matching destination premises or invalid value): ${dropped.join(', ')}`);
    }
    return { fields, extra, candidate, notes };
}
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
// Storage checks and copies are independent per record, so run several at a time.
async function inGroups(values, run, size = 10) {
    for (let index = 0; index < values.length; index += size)
        await Promise.all(values.slice(index, index + size).map(run));
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
        const [sourceCategories, destCategories, destProducts, destPremises] = await Promise.all([
            transaction.get(source.collection('CATEGORY')), transaction.get(destination.collection('CATEGORY')),
            transaction.get(destination.collection('PRODUCT')),
            input.options.prices ? transaction.get(destination.collection('PREMISES')) : Promise.resolve(null),
        ]);
        const destinationPremises = new Set((destPremises?.docs ?? []).map(doc => doc.data().name).filter((name) => typeof name === 'string' && !!name.trim()).map(premiseName));
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
        // Category Transfer never adds products into a category that is already present in the destination.
        const presentCategories = new Set();
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
                if (input.mode === 'categories')
                    presentCategories.add(id);
                if (typeof category.imagePath === 'string')
                    existingImageChecks.push({ type: 'category', sourceId: id,
                        sourceImagePath: category.imagePath, destinationImagePath: categoryMap.get(targetId)?.imagePath,
                        destinationOutletId: input.destinationOutletId, destinationDocumentId: targetId });
                items.push({ type: 'category', sourceId: id, name, status: 'already-transferred', destinationId: targetId, reason: 'Previously transferred category retained; no fields overwritten.' });
                continue;
            }
            // A same-named destination category is already present and is never modified or duplicated.
            // Product Transfer may place new products in it; Category Transfer adds nothing to it.
            const sameName = [...categoryMap].filter(([, target]) => normalized(target.name) && normalized(target.name) === normalized(category.name));
            if (sameName.length === 1) {
                if (input.mode === 'categories')
                    presentCategories.add(id);
                else
                    mappings.set(id, sameName[0][0]);
                items.push({ type: 'category', sourceId: id, name, status: 'already-transferred', destinationId: sameName[0][0], reason: 'Category already present in the destination.' });
                continue;
            }
            if (sameName.length > 1) {
                skip('category', id, name, 'More than one destination category has this name. Select the destination category to use.');
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
        // Read all selected source products together rather than one round trip per product.
        const sourceProducts = await Promise.all(input.products.map(selection => transaction.get(source.collection('PRODUCT').doc(selection.sourceProductId))));
        for (const [index, selection] of input.products.entries()) {
            const id = selection.sourceProductId;
            const document = sourceProducts[index];
            const product = document.data();
            const name = typeof product?.name === 'string' ? product.name : id;
            if (!document.exists || !product) {
                skip('product', id, name, 'Source product no longer exists.');
                continue;
            }
            sourceImageReferences.set(`PRODUCT/${id}`, input.options.images ? JSON.stringify([product.imagePath ?? null, product.image ?? null]) : null);
            // With Images unchecked the product is created without image fields; source images are never touched.
            const filenamePath = input.options.images ? productImageStoragePath(product.image) : null;
            const imagePath = input.options.images ? resolveProductImagePath(product, sourceId, id) : null;
            // Never silently drop an unsupported image value or replace an invalid Web path
            // with a different image. These records need review before a safe transfer.
            if (input.options.images && !imagePath && ((product.image != null && product.image !== '') || (product.imagePath != null && product.imagePath !== ''))) {
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
            const optional = optionalProductData(product, input.options, destinationPremises);
            const selectedFields = [...new Set([...selection.fields, ...optional.fields])];
            // A product without a category (or whose source category no longer exists) is copied
            // with no category, so the destination lists it under All.
            const uncategorized = typeof product.category !== 'string' || !sourceCategoryMap.has(product.category);
            const requiredFields = uncategorized ? ['name', 'taxIndex', 'unitId'] : ['name', 'category', 'taxIndex', 'unitId'];
            if (!requiredFields.every(field => selectedFields.includes(field))) {
                skip('product', id, name, 'New products require Product Name, Category, Tax Index and Unit ID selections.');
                continue;
            }
            if (!uncategorized && presentCategories.has(product.category)) {
                skip('product', id, name, 'Its category is already present in the destination, so it was not added.');
                continue;
            }
            const mappedCategory = uncategorized ? '' : mappings.get(product.category);
            if (!uncategorized && (!mappedCategory || !categoryMap.has(mappedCategory))) {
                skip('product', id, name, 'Select a valid destination category or transfer the required category.');
                continue;
            }
            if (selectedFields.some(field => field !== 'category' && (product[field] === undefined || product[field] === null))) {
                skip('product', id, name, 'A selected source field is unavailable.');
                continue;
            }
            if (selectedFields.includes('price')) {
                let defaultPrice;
                try {
                    defaultPrice = JSON.parse(String(product.priceTable))?.['default price'];
                }
                catch {
                    defaultPrice = undefined;
                }
                // Products without a price table (combos, raw materials) use their Selling Price.
                if (defaultPrice !== undefined && defaultPrice !== product.price) {
                    skip('product', id, name, 'Selling Price and the existing default price table must agree; separate price mappings are unsupported.');
                    continue;
                }
            }
            const candidate = { name: '', regionalName: '', shortName: '', category: mappedCategory ?? '', price: 0, mrpPrice: 0,
                costPrice: 0, taxIndex: -1, unitId: -1, hsnCode: '', discount: 0, stockable: false, weighable: false, ...optional.candidate };
            for (const field of selectedFields)
                if (field !== 'category' && field !== 'barcode')
                    candidate[field] = product[field];
            const productSchema = newProductSchema.omit({ requestId: true, code: true });
            const valid = (uncategorized ? productSchema.extend({ category: z.literal('') }) : productSchema).safeParse(candidate);
            if (!valid.success) {
                skip('product', id, name, 'A selected source field is missing or invalid.');
                continue;
            }
            // Tax and unit are copied exactly as the source POS stores them, e.g. tax 0 on combos and
            // Android units newer than the web unit list. The category was resolved above.
            let barcode = '';
            if (selectedFields.includes('barcode')) {
                if (typeof product.barcode !== 'string' || product.barcode.length > 200) {
                    skip('product', id, name, 'Selected barcode is missing or invalid.');
                    continue;
                }
                barcode = product.barcode;
            }
            // A destination product with the same name or barcode is reported as already present.
            // It is never merged or overwritten, and its stock is unchanged.
            const existing = [...productMap].find(([, target]) => normalized(target.name) === normalized(valid.data.name)
                || (!!usableBarcode(product.barcode) && usableBarcode(target.barcode) === usableBarcode(product.barcode)));
            if (existing) {
                items.push({ type: 'product', sourceId: id, name, status: 'already-transferred', destinationId: existing[0], reason: 'Product already present in the destination.' });
                continue;
            }
            const code = nextProductCode([...productMap].map(([productId, fields]) => ({ id: productId, fields })));
            const base = productFields(valid.data, code, barcode);
            const { premisePrices, ...extra } = optional.extra;
            // Keep the source product type so combos and raw materials stay what they are.
            const fields = { ...base, ...extra, ...(Number.isSafeInteger(product.type) ? { type: product.type } : {}), id: targetId, dateTme: Timestamp.now() };
            if (premisePrices)
                fields.priceTable = JSON.stringify({ ...JSON.parse(base.priceTable), ...premisePrices });
            plans.push({ collection: 'PRODUCT', id: targetId, fields, sourceId: id, name,
                ...(imagePath ? { sourceImagePath: imagePath } : {}),
                ...(filenamePath ? { sourceProductImage: product.image } : {}), ...(mappedCategory ? { destinationCategoryId: mappedCategory } : {}) });
            productMap.set(targetId, fields);
            const stockNote = 'currentStock' in fields && fields.currentStock !== 0 ? `Product copied with stock ${String(fields.currentStock)}.` : 'Product copied with zero stock.';
            items.push({ type: 'product', sourceId: id, name, status: 'created', destinationId: targetId, destinationNumber: code,
                reason: [stockNote, ...optional.notes.map(note => `Note: ${note}.`)].join(' ') });
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
    await inGroups(preflight.existingImageChecks, async (check) => {
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
    });
    const imagePaths = new Map();
    const verifiedSharedImages = new Set();
    // Categories go first so a failed category image still blocks its products.
    const copyImage = async (plan) => {
        if (!plan.sourceImagePath)
            return;
        if (plan.collection === 'PRODUCT' && failedCategories.has(plan.destinationCategoryId ?? '')) {
            const item = preflight.items.find(value => value.sourceId === plan.sourceId && value.type === 'product');
            item.status = 'skipped';
            item.reason = 'The destination category image could not be verified; dependent product was not created.';
            blockedPlans.add(`${plan.collection}/${plan.id}`);
            outcomeOverrides.set(itemKey('product', plan.sourceId), item.reason);
            return;
        }
        try {
            if (plan.sourceProductImage && plan.sourceImagePath === productImageStoragePath(plan.sourceProductImage)) {
                if (!await verifyExistingProductImage(bucket, plan.sourceProductImage)) {
                    throw new ImageStorageError(404, 'The existing product image could not be verified in the configured bucket; no destination record was created.');
                }
                // The global object already exists and is shared without modification. The
                // authenticated reader can resolve it for the destination without a duplicate upload.
                verifiedSharedImages.add(`${plan.collection}/${plan.id}`);
                return;
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
    };
    await inGroups(preflight.plans.filter(plan => plan.collection === 'CATEGORY'), copyImage);
    await inGroups(preflight.plans.filter(plan => plan.collection === 'PRODUCT'), copyImage);
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