import { createHash } from 'node:crypto';
import type { DocumentReference, Firestore, WriteBatch } from 'firebase-admin/firestore';
import { z } from 'zod';
import { ProductCreationError, requireProductOutlet } from './productCreation.js';

type Assignments = (profile: Record<string, unknown>) => string[];
const schema = z.object({
  requestId: z.uuid(), name: z.string().trim().min(1, 'Enter a service point name.').max(200),
  paperSize: z.union([z.literal(2), z.literal(3)]),
  printerType: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  header: z.string().trim().max(2000), subHeader: z.string().trim().max(2000), footer: z.string().trim().max(2000),
  printerIpAddress: z.string().trim().max(255), port: z.number().int().min(0).max(65535),
  usbPath: z.string().trim().max(1000).nullable(),
}).strict();
const text = (value: unknown) => typeof value === 'string' ? value : '';
const normalize = (value: unknown) => text(value).trim().replace(/\s+/g, ' ').toLowerCase();
function validateTarget(outletId: string, profileId: string | null) {
  if (!profileId) throw new ProductCreationError(401, 'Your session has expired. Please sign in again.');
  if (!outletId || outletId.length > 200 || outletId.includes('/') || outletId === '.' || outletId === '..') {
    throw new ProductCreationError(400, 'A valid outlet is required.');
  }
}
export function servicePointDetails(documentId: string, fields: Record<string, unknown>) {
  return { documentId, name: text(fields.name), paperSize: typeof fields.paperSize === 'number' ? fields.paperSize : null,
    printerType: typeof fields.printerType === 'number' ? fields.printerType : null,
    header: text(fields.header), subHeader: text(fields.subHeader), footer: text(fields.footer),
    printerIpAddress: text(fields.printerIpAddress), port: typeof fields.port === 'number' ? fields.port : null,
    usbPath: typeof fields.usbPath === 'string' ? fields.usbPath : null };
}
export async function listOutletServicePoints(db: Firestore, outletId: string, profileId: string | null, assigned: Assignments) {
  validateTarget(outletId, profileId);
  requireProductOutlet(profileId, outletId, (await db.collection('USER_PROFILE').doc(profileId!).get()).data(), assigned);
  const outlet = db.collection('OUTLET').doc(outletId);
  const record = await outlet.get();
  if (!record.exists) throw new ProductCreationError(404, 'Outlet not found.');
  if (record.data()?.active !== true) throw new ProductCreationError(403, 'This outlet is inactive.');
  const snapshot = await outlet.collection('SERVICE_POINT').get();
  return { servicePoints: snapshot.docs.map(doc => servicePointDetails(doc.id, doc.data())).sort((a, b) => a.name.localeCompare(b.name)) };
}
export async function createOutletServicePoint(db: Firestore, outletId: string, profileId: string | null, assigned: Assignments, raw: unknown) {
  validateTarget(outletId, profileId);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new ProductCreationError(422, parsed.error.issues[0]?.message || 'Check the service point details.');
  const { requestId, ...data } = parsed.data;
  const id = createHash('sha256').update(`service-point:${outletId}:${profileId}:${requestId}`).digest('hex').slice(0, 20);
  const outlet = db.collection('OUTLET').doc(outletId), collection = outlet.collection('SERVICE_POINT');
  return db.runTransaction(async transaction => {
    requireProductOutlet(profileId, outletId, (await transaction.get(db.collection('USER_PROFILE').doc(profileId!))).data(), assigned);
    const parent = await transaction.get(outlet);
    if (!parent.exists) throw new ProductCreationError(404, 'Outlet not found.');
    if (parent.data()?.active !== true) throw new ProductCreationError(403, 'This outlet is inactive.');
    const records = await transaction.get(collection);
    const saved = records.docs.find(doc => doc.id === id);
    if (saved) {
      if (Object.entries(data).some(([key, value]) => saved.data()[key] !== value)) {
        throw new ProductCreationError(409, 'This request already saved different service point details. Return to the list.');
      }
      return servicePointDetails(id, saved.data());
    }
    if (records.docs.some(doc => normalize(doc.data().name) === normalize(data.name))) {
      throw new ProductCreationError(409, 'A service point with this name already exists.');
    }
    // Existing SERVICE_POINT fields only; no product assignment or printer connection is changed.
    const fields = { ...data, id };
    transaction.create(collection.doc(id), fields);
    return servicePointDetails(id, fields);
  });
}

export async function updateOutletServicePoint(db: Firestore, outletId: string, documentId: string, profileId: string | null, assigned: Assignments, raw: unknown) {
  validateTarget(outletId, profileId);
  if (!documentId || documentId.length > 200 || documentId.includes('/') || documentId === '.' || documentId === '..') {
    throw new ProductCreationError(400, 'A valid service point is required.');
  }
  const parsed = schema.omit({ requestId: true }).partial().strict().safeParse(raw);
  if (!parsed.success) throw new ProductCreationError(422, 'Check the service point details. Only editable settings can be updated.');
  const outlet = db.collection('OUTLET').doc(outletId), collection = outlet.collection('SERVICE_POINT');
  return db.runTransaction(async transaction => {
    requireProductOutlet(profileId, outletId, (await transaction.get(db.collection('USER_PROFILE').doc(profileId!))).data(), assigned);
    const parent = await transaction.get(outlet);
    if (!parent.exists) throw new ProductCreationError(404, 'Outlet not found.');
    if (parent.data()?.active !== true) throw new ProductCreationError(403, 'This outlet is inactive.');
    const records = await transaction.get(collection);
    const saved = records.docs.find(doc => doc.id === documentId);
    if (!saved) throw new ProductCreationError(404, 'This service point no longer exists.');
    if (parsed.data.name !== undefined && records.docs.some(doc => doc.id !== documentId && normalize(doc.data().name) === normalize(parsed.data.name))) {
      throw new ProductCreationError(409, 'A service point with this name already exists.');
    }
    const changes = Object.fromEntries(Object.entries(parsed.data).filter(([key, value]) => value !== saved.data()[key]));
    if (Object.keys(changes).length) transaction.update(collection.doc(documentId), changes);
    return servicePointDetails(documentId, { ...saved.data(), ...changes });
  });
}

export async function deleteOutletServicePoint(db: Firestore, outletId: string, documentId: string, profileId: string | null, assigned: Assignments) {
  validateTarget(outletId, profileId);
  if (!documentId || documentId.length > 200 || documentId.includes('/') || documentId === '.' || documentId === '..') {
    throw new ProductCreationError(400, 'A valid service point is required.');
  }
  const outlet = db.collection('OUTLET').doc(outletId);
  return db.runTransaction(async transaction => {
    requireProductOutlet(profileId, outletId, (await transaction.get(db.collection('USER_PROFILE').doc(profileId!))).data(), assigned);
    const parent = await transaction.get(outlet);
    if (!parent.exists) throw new ProductCreationError(404, 'Outlet not found.');
    if (parent.data()?.active !== true) throw new ProductCreationError(403, 'This outlet is inactive.');
    const ref = outlet.collection('SERVICE_POINT').doc(documentId);
    const saved = await transaction.get(ref);
    const products = await transaction.get(outlet.collection('PRODUCT').where('kitchenId', '==', documentId));
    // Use the existing unassigned value and change only this outlet's matching references.
    // Clearing assignments and deleting the master commit together, including on retries.
    products.docs.forEach(doc => transaction.update(outlet.collection('PRODUCT').doc(doc.id), { kitchenId: '' }));
    if (saved.exists) transaction.delete(ref);
    return { documentId };
  });
}

export async function assignCategoryServicePoint(db: Firestore, outletId: string, profileId: string | null, assigned: Assignments, raw: unknown) {
  validateTarget(outletId, profileId);
  const id = z.string().min(1).max(200).refine(value => !value.includes('/') && value !== '.' && value !== '..');
  const parsed = z.object({ categoryId: id, servicePointId: id }).strict().safeParse(raw);
  if (!parsed.success) throw new ProductCreationError(422, 'Select a category and a service point.');
  const { categoryId, servicePointId } = parsed.data;
  const outlet = db.collection('OUTLET').doc(outletId);
  return db.runTransaction(async transaction => {
    requireProductOutlet(profileId, outletId, (await transaction.get(db.collection('USER_PROFILE').doc(profileId!))).data(), assigned);
    const parent = await transaction.get(outlet);
    if (!parent.exists) throw new ProductCreationError(404, 'Outlet not found.');
    if (parent.data()?.active !== true) throw new ProductCreationError(403, 'This outlet is inactive.');
    const [category, servicePoint, products] = await Promise.all([
      transaction.get(outlet.collection('CATEGORY').doc(categoryId)),
      transaction.get(outlet.collection('SERVICE_POINT').doc(servicePointId)),
      transaction.get(outlet.collection('PRODUCT').where('category', '==', categoryId)),
    ]);
    if (!category.exists) throw new ProductCreationError(404, 'This category no longer exists in this outlet.');
    if (!servicePoint.exists) throw new ProductCreationError(404, 'This service point no longer exists in this outlet.');
    if (!products.docs.length) throw new ProductCreationError(409, 'This category has no products to assign.');
    const changed = products.docs.filter(doc => doc.data().kitchenId !== servicePointId);
    // kitchenId is the existing scalar reference to the SERVICE_POINT document ID.
    // The transaction assigns the entire category atomically, including hidden rows.
    changed.forEach(doc => transaction.update(outlet.collection('PRODUCT').doc(doc.id), { kitchenId: servicePointId }));
    return { categoryId, servicePointId, assignedCount: products.docs.length, updatedCount: changed.length };
  });
}

const DELETE_ALL_SERVICE_POINTS = 'DELETE_ALL_SERVICE_POINTS';
const BATCH_SIZE = 400;

// Deletes every service point of the outlet after explicit confirmation. Like a
// single deletion, products assigned to them are first set to the existing
// unassigned value; masters are deleted only after every product is cleared, so a
// failure never leaves a product pointing at a removed service point. Retrying
// finishes whatever remains.
export async function deleteAllOutletServicePoints(db: Firestore, outletId: string, profileId: string | null, assigned: Assignments, body: unknown) {
  validateTarget(outletId, profileId);
  if (!body || typeof body !== 'object' || (body as Record<string, unknown>).confirm !== DELETE_ALL_SERVICE_POINTS) {
    throw new ProductCreationError(400, 'Delete all must be confirmed.');
  }
  requireProductOutlet(profileId, outletId, (await db.collection('USER_PROFILE').doc(profileId!).get()).data(), assigned);
  const outlet = db.collection('OUTLET').doc(outletId);
  const parent = await outlet.get();
  if (!parent.exists) throw new ProductCreationError(404, 'Outlet not found.');
  if (parent.data()?.active !== true) throw new ProductCreationError(403, 'This outlet is inactive.');
  const servicePoints = (await outlet.collection('SERVICE_POINT').select().get()).docs;
  const ids = servicePoints.map(doc => doc.id);
  const products = [];
  for (let start = 0; start < ids.length; start += 30) {
    products.push(...(await outlet.collection('PRODUCT').where('kitchenId', 'in', ids.slice(start, start + 30)).select().get()).docs);
  }
  const commit = async (refs: { ref: DocumentReference }[], write: (batch: WriteBatch, ref: DocumentReference) => void, label: string) => {
    let done = 0;
    for (let start = 0; start < refs.length; start += BATCH_SIZE) {
      const batch = db.batch();
      const chunk = refs.slice(start, start + BATCH_SIZE);
      chunk.forEach(doc => write(batch, doc.ref));
      try { await batch.commit(); }
      catch { throw new ProductCreationError(503, `${done} of ${refs.length} ${label} before an error. Retry Delete All to finish.`); }
      done += chunk.length;
    }
    return done;
  };
  const unassignedProducts = await commit(products, (batch, ref) => batch.update(ref, { kitchenId: '' }), 'products unassigned');
  const deleted = await commit(servicePoints, (batch, ref) => batch.delete(ref), 'service points deleted');
  return { deleted, unassignedProducts };
}
