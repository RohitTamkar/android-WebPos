import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { ProductCreationError, requireProductOutlet } from './productCreation.js';
import { receiptSupplierFromMaster } from './suppliers.js';
const recordId = z.string().min(1).max(200).refine(id => !id.includes('/') && id !== '.' && id !== '..');
const autoId = z.string().regex(/^[A-Za-z0-9]{20}$/);
const price = z.number().finite().nonnegative().max(1e9);
export const receiptSupplierSchema = z.object({
    id: recordId, name: z.string().min(1).max(200).refine(value => !!value.trim()),
    mobile: z.string().min(1).max(200).refine(value => !!value.trim()), address: z.string().max(500),
    alternateNumber: z.null(), email: z.string().max(320), gstin: z.string().max(200),
}).strict();
const inputSchema = z.object({
    documentId: autoId, goodsReceivedNo: z.string().trim().min(1).max(100), supplier: receiptSupplierSchema.nullish().transform(value => value ?? null),
    items: z.array(z.object({ productId: recordId, quantity: z.number().finite().positive().max(1e9).multipleOf(0.001), cost: price, price }).strict()).min(1).max(100),
}).strict();
// Suppliers come from the verified outlet-specific SUPPLIER master.
export async function loadGoodsReceived(db, outletId, profileId, assigned) {
    if (!recordId.safeParse(outletId).success)
        throw new ProductCreationError(400, 'A valid outlet is required.');
    requireProductOutlet(profileId, outletId, profileId ? (await db.collection('USER_PROFILE').doc(profileId).get()).data() : undefined, assigned);
    const outlet = db.collection('OUTLET').doc(outletId);
    if ((await outlet.get()).data()?.active !== true)
        throw new ProductCreationError(403, 'This outlet is inactive or unavailable.');
    const goods = outlet.collection('GOODS_RECEIVED');
    const [snapshot, supplierSnapshot] = await Promise.all([goods.get(), outlet.collection('SUPPLIER').get()]);
    const receipts = snapshot.docs.map(document => ({ documentId: document.id, fields: document.data() }))
        .sort((a, b) => Number(b.fields.createDate ?? 0) - Number(a.fields.createDate ?? 0));
    const suppliers = supplierSnapshot.docs.flatMap(document => {
        const supplier = receiptSupplierFromMaster(document.id, document.data());
        return supplier ? [supplier] : [];
    }).sort((a, b) => a.name.localeCompare(b.name));
    // Allocating references generates auto-IDs locally and writes no documents.
    return { documentId: goods.doc().id, supplierDraftId: outlet.collection('SUPPLIER').doc().id, suppliers, receipts };
}
export async function saveGoodsReceived(run, outletId, profileId, assigned, raw, clock = () => new Date()) {
    if (!profileId)
        throw new ProductCreationError(401, 'Your session has expired. Please sign in again.');
    const parsed = inputSchema.safeParse(raw);
    if (!recordId.safeParse(outletId).success || !parsed.success)
        throw new ProductCreationError(422, 'Enter a receipt number and positive quantities with up to three decimal places; prices must be zero or more.');
    const input = parsed.data;
    if (new Set(input.items.map(item => item.productId)).size !== input.items.length)
        throw new ProductCreationError(422, 'Each product can appear only once.');
    const collection = `OUTLET/${outletId}/GOODS_RECEIVED`;
    const path = `${collection}/${input.documentId}`;
    return run(async (transaction) => {
        requireProductOutlet(profileId, outletId, await transaction.read(`USER_PROFILE/${profileId}`), assigned);
        if ((await transaction.read(`OUTLET/${outletId}`))?.active !== true)
            throw new ProductCreationError(403, 'This outlet is inactive or unavailable.');
        const previous = await transaction.read(path);
        if (previous) {
            const items = Array.isArray(previous.goodsReceivedItemBeanList) ? previous.goodsReceivedItemBeanList : [];
            const same = previous.type === 'STOCK-IN' && previous.addType === 'POS' && previous.goodsReceivedNo === input.goodsReceivedNo
                && isDeepStrictEqual(previous.supplier ?? null, input.supplier) && items.length === input.items.length
                && input.items.every((item, index) => items[index]?.productid === item.productId && items[index]?.quantity === item.quantity
                    && items[index]?.cost === item.cost && items[index]?.price === item.price);
            if (!same)
                throw new ProductCreationError(409, 'This confirmation already saved different receipt details.');
            return { documentId: input.documentId, alreadySaved: true };
        }
        const records = await transaction.list(collection);
        if (records.some(record => record.fields.goodsReceivedNo === input.goodsReceivedNo))
            throw new ProductCreationError(409, 'This receipt number already exists in this outlet. Enter a different number.');
        if (input.supplier) {
            const supplierMaster = await transaction.read(`OUTLET/${outletId}/SUPPLIER/${input.supplier.id}`);
            const supplier = receiptSupplierFromMaster(input.supplier.id, supplierMaster);
            if (!supplier)
                throw new ProductCreationError(422, 'Select an existing supplier from this outlet.');
            if (!isDeepStrictEqual(supplier, input.supplier))
                throw new ProductCreationError(409, 'Supplier details changed. Reload and select the supplier again.');
        }
        const products = await Promise.all(input.items.map(item => transaction.read(`OUTLET/${outletId}/PRODUCT/${item.productId}`)));
        const lines = input.items.map((item, index) => {
            const product = products[index];
            if (!product)
                throw new ProductCreationError(404, 'A selected product no longer exists in this outlet.');
            if (product.stockable !== true)
                throw new ProductCreationError(422, 'Only stockable products can be received.');
            if (typeof product.currentStock !== 'number' || !Number.isFinite(product.currentStock))
                throw new ProductCreationError(422, 'A selected product has an invalid stock value.');
            if (typeof product.name !== 'string' || !product.name.trim() || typeof product.weighable !== 'boolean')
                throw new ProductCreationError(422, 'A selected product has unsupported name or weighable data.');
            return { mapValue: { fields: {
                        canWeight: { booleanValue: product.weighable }, cost: { doubleValue: item.cost }, currentStock: { doubleValue: product.currentStock },
                        id: { nullValue: null }, name: { stringValue: product.name }, price: { doubleValue: item.price },
                        productid: { stringValue: item.productId }, quantity: { doubleValue: item.quantity }, selected: { booleanValue: true },
                        state: { integerValue: '0' }, total: { doubleValue: 0 },
                    } } };
        });
        const now = clock();
        const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
        const part = (type) => parts.find(value => value.type === type).value;
        const fields = {
            addType: { stringValue: 'POS' }, createDate: { integerValue: String(now.getTime()) }, dayID: { stringValue: `${part('year')}-${part('month')}-${part('day')}` },
            finalTotal: { doubleValue: 0 }, formattedDate: { nullValue: null }, goodsReceivedItemBeanList: { arrayValue: { values: lines } },
            goodsReceivedNo: { stringValue: input.goodsReceivedNo }, id: { nullValue: null }, quantity: { doubleValue: 0 }, remark: { nullValue: null },
            roundOff: { doubleValue: 0 }, state: { integerValue: '0' }, supplier: input.supplier ? { mapValue: { fields: Object.fromEntries(Object.entries(input.supplier).map(([key, value]) => [key, value === null ? { nullValue: null } : { stringValue: value }])) } } : { nullValue: null },
            total: { doubleValue: 0 }, type: { stringValue: 'STOCK-IN' },
        };
        // Receipt-only save: exactly one create. Never update a PRODUCT or a supplier master.
        transaction.create(path, fields);
        return { documentId: input.documentId, alreadySaved: false };
    });
}
//# sourceMappingURL=goodsReceived.js.map