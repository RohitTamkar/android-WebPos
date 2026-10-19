import { createHash } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';
import { ProductCreationError, newProductSchema, productTaxes, requireProductOutlet, validateProductReferences } from './productCreation.js';
import { productFields } from './productDefaults.js';
import { nextProductCode } from './productImportValidation.js';

const audience = 'pos-master-transfer';
function requireSigningKey(secret: string) {
  if (Buffer.byteLength(secret, 'utf8') < 32) throw new ProductCreationError(503, 'Transfer authorization is unavailable. Configure MASTER_TRANSFER_SECRET with at least 32 bytes on the server.');
}
const recordId = z.string().min(1).max(200).refine(value => !value.includes('/') && value !== '.' && value !== '..');
const copyFields = z.enum(['name', 'regionalName', 'shortName', 'category', 'price', 'mrpPrice', 'costPrice', 'taxIndex', 'unitId', 'hsnCode', 'barcode', 'discount', 'stockable', 'weighable']);
const requestSchema = z.object({
  destinationOutletId: recordId, mode: z.enum(['categories', 'products']),
  categoryIds: z.array(recordId).max(100),
  products: z.array(z.object({ sourceProductId: recordId, fields: z.array(copyFields).min(1).max(14) }).strict()).max(100),
  categoryMappings: z.record(recordId, recordId),
}).strict();
export interface TransferItem {
  type: 'category' | 'product'; sourceId: string; name: string;
  status: 'created' | 'already-transferred' | 'mapped' | 'skipped'; reason: string; destinationId?: string; destinationNumber?: number;
}
const normalized = (value: unknown) => typeof value === 'string' ? value.trim().toLowerCase() : '';
const usableBarcode = (value: unknown) => typeof value === 'string' && value.trim() !== '0' ? value.trim() : '';
const destinationId = (type: string, sourceOutlet: string, sourceId: string, destination: string) =>
  createHash('sha256').update(JSON.stringify(['master-transfer-v1', type, sourceOutlet, sourceId, destination])).digest('hex').slice(0, 32);

// The grant deliberately uses sub, not profileDocId: it cannot be used as a normal login token.
export function issueTransferAuthorization(secret: string, profileId: string, sourceOutletId: string, destinationOutletId: string) {
  requireSigningKey(secret);
  return jwt.sign({ sourceOutletId, destinationOutletId, purpose: 'master-transfer' }, secret,
    { subject: profileId, audience, expiresIn: '5m' });
}
export function requireTransferAuthorization(secret: string, grant: string | undefined, profileId: string, source: string, destination: string) {
  requireSigningKey(secret);
  try {
    const payload = jwt.verify(grant ?? '', secret, { audience, algorithms: ['HS256'] });
    if (typeof payload === 'string' || payload.sub !== profileId || payload.sourceOutletId !== source
      || payload.destinationOutletId !== destination || payload.purpose !== 'master-transfer') throw new Error();
  } catch { throw new ProductCreationError(403, 'QuickPin authorization expired or is invalid for these outlets. Verify your QuickPin again.'); }
}

// Create-only master transfers. No source writes, destination updates, stock/history writes, or new schema fields.
export async function transferOutletMasters(db: Firestore, sourceId: string, profileId: string | null,
  assigned: (profile: Record<string, unknown>) => string[], secret: string, grant: string | undefined, raw: unknown) {
  if (!profileId) throw new ProductCreationError(401, 'Your session has expired. Please sign in again.');
  const parsed = requestSchema.safeParse(raw);
  if (!recordId.safeParse(sourceId).success || !parsed.success) throw new ProductCreationError(422, 'Invalid transfer selection or unsupported fields.');
  const input = parsed.data;
  if (sourceId === input.destinationOutletId || input.categoryIds.length + input.products.length > 100
    || (input.mode === 'categories' && (input.products.length || !input.categoryIds.length))
    || (input.mode === 'products' && !input.products.length)
    || new Set(input.categoryIds).size !== input.categoryIds.length
    || new Set(input.products.map(product => product.sourceProductId)).size !== input.products.length
    || input.products.some(product => new Set(product.fields).size !== product.fields.length)
    || Object.keys(input.categoryMappings).length > 100) throw new ProductCreationError(422, 'Select between 1 and 100 unique records for this transfer.');
  requireTransferAuthorization(secret, grant, profileId, sourceId, input.destinationOutletId);
  const source = db.collection('OUTLET').doc(sourceId);
  const destination = db.collection('OUTLET').doc(input.destinationOutletId);
  return db.runTransaction(async transaction => {
    requireTransferAuthorization(secret, grant, profileId, sourceId, input.destinationOutletId);
    const profile = (await transaction.get(db.collection('USER_PROFILE').doc(profileId))).data();
    requireProductOutlet(profileId, sourceId, profile, assigned);
    requireProductOutlet(profileId, input.destinationOutletId, profile, assigned);
    const outlets = await Promise.all([transaction.get(source), transaction.get(destination)]);
    if (outlets.some(outlet => !outlet.exists)) throw new ProductCreationError(404, 'An outlet no longer exists.');
    const [sourceCategories, destCategories, destProducts, taxes] = await Promise.all([
      transaction.get(source.collection('CATEGORY')), transaction.get(destination.collection('CATEGORY')),
      transaction.get(destination.collection('PRODUCT')), transaction.get(db.collection('MASTERS').doc('masters').collection('TAX_MASTER')),
    ]);
    const sourceCategoryMap = new Map(sourceCategories.docs.map(doc => [doc.id, doc.data()]));
    const categoryMap = new Map(destCategories.docs.map(doc => [doc.id, doc.data()]));
    const productMap = new Map(destProducts.docs.map(doc => [doc.id, doc.data()]));
    const mappings = new Map<string, string>();
    for (const [from, to] of Object.entries(input.categoryMappings)) {
      if (!sourceCategoryMap.has(from) || !categoryMap.has(to)) throw new ProductCreationError(422, 'Category mappings must reference source and destination categories.');
      mappings.set(from, to);
    }
    const items: TransferItem[] = [];
    const plans: { collection: 'CATEGORY' | 'PRODUCT'; id: string; fields: Record<string, unknown> }[] = [];
    const skip = (type: 'category' | 'product', id: string, name: string, reason: string) => items.push({ type, sourceId: id, name, status: 'skipped', reason });
    for (const id of input.categoryIds) {
      const category = sourceCategoryMap.get(id);
      const name = typeof category?.name === 'string' ? category.name : id;
      if (!category) { skip('category', id, name, 'Source category no longer exists.'); continue; }
      if (mappings.has(id)) {
        items.push({ type: 'category', sourceId: id, name, status: 'mapped', destinationId: mappings.get(id)!, reason: 'Used the explicitly selected existing category; no record changed.' }); continue;
      }
      const targetId = destinationId('category', sourceId, id, input.destinationOutletId);
      if (categoryMap.has(targetId)) {
        mappings.set(id, targetId);
        items.push({ type: 'category', sourceId: id, name, status: 'already-transferred', destinationId: targetId, reason: 'Previously transferred category retained; no fields overwritten.' }); continue;
      }
      const valid = z.object({ name: z.string().trim().min(1).max(200), categoryNo: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
        regionalName: z.string().max(200).default(''), dayType: z.string().max(100).default('') }).safeParse({
        name: category.name, categoryNo: [...categoryMap.values()].reduce((highest, target) => {
          const value = Number(target.categoryNo);
          return Number.isSafeInteger(value) && value > highest ? value : highest;
        }, 0) + 1, regionalName: category.regionalName ?? '', dayType: category.dayType ?? '',
      });
      if (!valid.success) { skip('category', id, name, 'Source category fields are not supported by the existing category model.'); continue; }
      if ([...categoryMap.values()].some(target => normalized(target.name) === normalized(valid.data.name))) {
        skip('category', id, name, 'A category with this name already exists. Existing category retained; no duplicate created. Select it as the destination category when copying products.'); continue;
      }
      const fields = { ...valid.data, id: targetId, onlineSynced: false, selected: false };
      plans.push({ collection: 'CATEGORY', id: targetId, fields }); categoryMap.set(targetId, fields); mappings.set(id, targetId);
      items.push({ type: 'category', sourceId: id, name, status: 'created', destinationId: targetId, destinationNumber: valid.data.categoryNo, reason: 'Category copied.' });
    }
    for (const selection of input.products) {
      const id = selection.sourceProductId;
      const document = await transaction.get(source.collection('PRODUCT').doc(id));
      const product = document.data();
      const name = typeof product?.name === 'string' ? product.name : id;
      if (!document.exists || !product) { skip('product', id, name, 'Source product no longer exists.'); continue; }
      const targetId = destinationId('product', sourceId, id, input.destinationOutletId);
      if (productMap.has(targetId)) {
        items.push({ type: 'product', sourceId: id, name, status: 'already-transferred', destinationId: targetId, reason: 'Previously transferred product retained. Existing fields and stock were not changed.' }); continue;
      }
      if (!['name', 'category', 'taxIndex', 'unitId'].every(field => selection.fields.includes(field as typeof selection.fields[number]))) {
        skip('product', id, name, 'New products require Product Name, Category, Tax Index and Unit ID selections.'); continue;
      }
      const mappedCategory = typeof product.category === 'string' ? mappings.get(product.category) : undefined;
      if (!mappedCategory || !categoryMap.has(mappedCategory)) { skip('product', id, name, 'Select a valid destination category or transfer the required category.'); continue; }
      if (selection.fields.some(field => field !== 'category' && (product[field] === undefined || product[field] === null))) {
        skip('product', id, name, 'A selected source field is unavailable.'); continue;
      }
      if (selection.fields.includes('price')) {
        let defaultPrice: unknown;
        try { defaultPrice = JSON.parse(String(product.priceTable))?.['default price']; } catch { defaultPrice = undefined; }
        if (defaultPrice !== product.price) { skip('product', id, name, 'Selling Price and the existing default price table must agree; separate price mappings are unsupported.'); continue; }
      }
      const candidate: Record<string, unknown> = { name: '', regionalName: '', shortName: '', category: mappedCategory, price: 0, mrpPrice: 0,
        costPrice: 0, taxIndex: -1, unitId: -1, hsnCode: '', discount: 0, stockable: false, weighable: false };
      for (const field of selection.fields) if (field !== 'category' && field !== 'barcode') candidate[field] = product[field];
      const valid = newProductSchema.omit({ requestId: true, code: true }).safeParse(candidate);
      if (!valid.success) { skip('product', id, name, 'A selected source field is missing or invalid.'); continue; }
      try { validateProductReferences(valid.data, [...categoryMap.keys()], productTaxes(taxes.docs.map(doc => doc.data()))); }
      catch { skip('product', id, name, 'Destination category, tax or unit reference is invalid.'); continue; }
      let barcode = '';
      if (selection.fields.includes('barcode')) {
        if (typeof product.barcode !== 'string' || product.barcode.length > 200) { skip('product', id, name, 'Selected barcode is missing or invalid.'); continue; }
        barcode = product.barcode;
      }
      // Name/barcode collisions are only warnings of possible identity: skip, never merge or overwrite.
      if ([...productMap.values()].some(target => normalized(target.name) === normalized(valid.data.name)
        || (!!usableBarcode(product.barcode) && usableBarcode(target.barcode) === usableBarcode(product.barcode)))) {
        skip('product', id, name, 'Possible destination name or barcode conflict. Existing product and stock preserved.'); continue;
      }
      const code = nextProductCode([...productMap].map(([productId, fields]) => ({ id: productId, fields })));
      const fields = { ...productFields(valid.data, code, barcode), id: targetId, dateTme: Timestamp.now() };
      plans.push({ collection: 'PRODUCT', id: targetId, fields }); productMap.set(targetId, fields);
      items.push({ type: 'product', sourceId: id, name, status: 'created', destinationId: targetId, destinationNumber: code, reason: 'Product copied with zero stock.' });
    }
    // All transactional reads precede writes. A failed commit returns no success results.
    for (const plan of plans) transaction.create(destination.collection(plan.collection).doc(plan.id), plan.fields);
    return { items, created: items.filter(item => item.status === 'created').length, skipped: items.filter(item => item.status === 'skipped').length,
      unchanged: items.filter(item => item.status === 'already-transferred' || item.status === 'mapped').length };
  });
}
