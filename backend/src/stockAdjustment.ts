import type { Firestore } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ProductCreationError, requireProductOutlet } from './productCreation.js';

const recordId = z.string().min(1).max(200).refine(id => !id.includes('/') && id !== '.' && id !== '..');
function movementDocumentId(requestId: string): string {
  if (requestId.length === 20) return requestId;
  // Stable conversion lets older clients retry without creating another record.
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = BigInt(`0x${createHash('sha256').update(requestId.toLowerCase()).digest('hex')}`);
  let id = '';
  for (let index = 0; index < 20; index++) {
    id += alphabet[Number(value % 62n)];
    value /= 62n;
  }
  return id;
}
const schema = z.object({
  requestId: z.union([z.string().regex(/^[A-Za-z0-9]{20}$/), z.uuid()]), direction: z.enum(['in', 'out']),
  items: z.array(z.object({ productId: recordId, quantity: z.number().finite().positive().max(1e9).multipleOf(0.001),
    expectedStock: z.number().finite(), remark: z.string().trim().max(500) }).strict()).min(1).max(100),
}).strict();

// Use only the PRODUCT.currentStock and GOODS_RECEIVED fields already consumed by
// the stock reports. The request ID lives in the document ID, not a new schema field.
export async function saveStockAdjustment(db: Firestore, outletId: string, profileId: string | null,
  assigned: (profile: Record<string, unknown>) => string[], raw: unknown) {
  if (!profileId) throw new ProductCreationError(401, 'Your session has expired. Please sign in again.');
  const parsed = schema.safeParse(raw);
  if (!recordId.safeParse(outletId).success || !parsed.success) throw new ProductCreationError(422, 'Select products and enter positive quantities with up to three decimal places.');
  const input = parsed.data;
  if (new Set(input.items.map(item => item.productId)).size !== input.items.length) throw new ProductCreationError(422, 'Each product can appear only once.');
  if (input.direction === 'out' && input.items.some(item => !item.remark)) throw new ProductCreationError(422, 'A remark is required for every stock-out item.');
  const items = [...input.items].sort((a, b) => a.productId.localeCompare(b.productId));
  const type = input.direction === 'in' ? 'STOCK-IN' : 'STOCK-OUT';
  const outlet = db.collection('OUTLET').doc(outletId);
  const goods = outlet.collection('GOODS_RECEIVED');
  const movement = goods.doc(movementDocumentId(input.requestId));
  return db.runTransaction(async transaction => {
    const profile = (await transaction.get(db.collection('USER_PROFILE').doc(profileId))).data();
    requireProductOutlet(profileId, outletId, profile, assigned);
    // Legacy IDs are read only: acknowledge previously committed requests, but
    // create every new movement using a 20-character alphanumeric document ID.
    const legacy = input.requestId.length === 20 ? null : await transaction.get(goods.doc(`stock-${input.requestId}`));
    const previous = legacy?.exists ? legacy : await transaction.get(movement);
    if (previous.exists) {
      const data = previous.data()!;
      const savedItems = Array.isArray(data.goodsReceivedItemBeanList) ? data.goodsReceivedItemBeanList : [];
      const same = data.type === type && savedItems.length === items.length && items.every((item, index) => {
        const saved = savedItems[index];
        return saved?.productid === item.productId && saved.quantity === item.quantity && saved.remark === item.remark;
      });
      if (!same) throw new ProductCreationError(409, 'This confirmation was already used for different stock changes. Reload before continuing.');
      return { documentId: legacy?.exists ? `stock-${input.requestId}` : movement.id, alreadySaved: true };
    }
    const products = await Promise.all(items.map(item => transaction.get(outlet.collection('PRODUCT').doc(item.productId))));
    const changes = items.map((item, index) => {
      const snapshot = products[index]!; const product = snapshot.data();
      if (!snapshot.exists || !product) throw new ProductCreationError(404, 'A selected product no longer exists. Reload the product list.');
      if (product.stockable !== true) throw new ProductCreationError(422, 'Only products marked Stockable can receive stock-in or stock-out adjustments. Refresh the product list.');
      const stock = product.currentStock;
      if (typeof stock !== 'number' || !Number.isFinite(stock) || Math.abs(stock) > 1e9) throw new ProductCreationError(422, 'A selected product has an unsupported current stock value.');
      if (stock !== item.expectedStock) throw new ProductCreationError(409, 'Stock changed since you loaded the products. Refresh and review the quantities again.');
      if (input.direction === 'out' && item.quantity > stock) throw new ProductCreationError(422, `Insufficient stock for ${String(product.name ?? item.productId)}.`);
      const nextStock = Math.round((stock + (input.direction === 'in' ? item.quantity : -item.quantity)) * 1e6) / 1e6;
      if (!Number.isFinite(nextStock) || Math.abs(nextStock) > 1e9) throw new ProductCreationError(422, 'The resulting stock is outside the supported range.');
      return { item, nextStock, name: typeof product.name === 'string' ? product.name : item.productId };
    });
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
    const part = (type: string) => parts.find(value => value.type === type)!.value;
    transaction.create(movement, {
      type, dayID: `${part('year')}-${part('month')}-${part('day')}`, createDate: now.getTime(),
      quantity: items.reduce((total, item) => total + item.quantity, 0),
      goodsReceivedItemBeanList: changes.map(({ item, name }) => ({ productid: item.productId, name, quantity: item.quantity, remark: item.remark })),
    });
    for (const { item, nextStock } of changes) transaction.update(outlet.collection('PRODUCT').doc(item.productId), { currentStock: nextStock });
    return { documentId: movement.id, alreadySaved: false };
  });
}
