import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Firestore } from 'firebase-admin/firestore';
import { ProductCreationError, requireProductOutlet } from './productCreation.js';

// Existing Android customer fields in OUTLET/{outletId}/CUSTOMER/{documentId}.
// Contacts and optional details can be empty in existing customer documents.
const contact = z.string().trim().max(30).refine(value => !value || /^\+?(?=.*\d)[\d ()-]+$/.test(value), 'Enter a valid mobile number.');
const date = z.union([z.literal(''), z.iso.date()]);
const customerSchema = z.object({
  requestId: z.uuid(), name: z.string().trim().max(200), contact, altContact: contact,
  email: z.union([z.literal(''), z.string().trim().email('Enter a valid email address.').max(320)]),
  gstNo: z.string().trim().max(100), address: z.string().trim().max(2000),
  creditLimit: z.number().finite(), dayLimit: z.number().int().nonnegative(), balance: z.number().finite(),
  birthdayDate: date, anniversaryDate: date, allowedCredit: z.boolean(),
}).strict();
const text = (value: unknown) => typeof value === 'string' ? value : '';
const amount = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : 0;
const contactKey = (value: unknown) => text(value).replace(/\D/g, '');
type Assignments = (profile: Record<string, unknown>) => string[];

export function customerDetails(documentId: string, fields: Record<string, unknown>) {
  return { documentId, name: text(fields.name), contact: text(fields.contact), altContact: text(fields.altContact),
    email: text(fields.email), gstNo: text(fields.gstNo), address: text(fields.address),
    creditLimit: amount(fields.creditLimit), dayLimit: amount(fields.dayLimit), balance: amount(fields.balance),
    birthdayDate: text(fields.birthdayDate), anniversaryDate: text(fields.anniversaryDate), allowedCredit: fields.allowedCredit === true };
}

// Returns the CUSTOMER collection once the user may read it. The profile and
// outlet reads run together; nothing is returned before both checks pass.
export async function authorizedCustomers(db: Firestore, outletId: string, profileId: string | null, assigned: Assignments) {
  if (!profileId) throw new ProductCreationError(401, 'Your session has expired. Please sign in again.');
  if (!outletId || outletId.includes('/')) throw new ProductCreationError(400, 'A valid outlet is required.');
  const outlet = db.collection('OUTLET').doc(outletId);
  const [profile, outletSnapshot] = await Promise.all([db.collection('USER_PROFILE').doc(profileId).get(), outlet.get()]);
  requireProductOutlet(profileId, outletId, profile.data(), assigned);
  if (!outletSnapshot.exists) throw new ProductCreationError(404, 'Outlet not found.');
  return outlet.collection('CUSTOMER');
}

export async function listOutletCustomers(db: Firestore, outletId: string, profileId: string | null, assigned: Assignments) {
  const snapshot = await (await authorizedCustomers(db, outletId, profileId, assigned)).get();
  return { customers: snapshot.docs.map(doc => customerDetails(doc.id, doc.data())).sort((a, b) => a.name.localeCompare(b.name)) };
}

export async function createOutletCustomer(db: Firestore, outletId: string, profileId: string | null, assigned: Assignments, raw: unknown) {
  if (!profileId) throw new ProductCreationError(401, 'Your session has expired. Please sign in again.');
  if (!outletId || outletId.includes('/')) throw new ProductCreationError(400, 'A valid outlet is required.');
  const parsed = customerSchema.safeParse(raw);
  if (!parsed.success) throw new ProductCreationError(422, parsed.error.issues[0]?.message || 'Check the customer details.');
  const { requestId, ...data } = parsed.data;
  const documentId = createHash('sha256').update(`customer:${profileId}:${requestId}`).digest('hex').slice(0, 20);
  const outlet = db.collection('OUTLET').doc(outletId);
  const collection = outlet.collection('CUSTOMER');
  return db.runTransaction(async transaction => {
    const profile = await transaction.get(db.collection('USER_PROFILE').doc(profileId));
    requireProductOutlet(profileId, outletId, profile.data(), assigned);
    if (!(await transaction.get(outlet)).exists) throw new ProductCreationError(404, 'Outlet not found.');
    const records = await transaction.get(collection);
    const saved = records.docs.find(doc => doc.id === documentId);
    if (saved) {
      if (Object.entries(data).some(([key, value]) => saved.data()[key] !== value)) {
        throw new ProductCreationError(409, 'This save request already created a different customer. Return to the list.');
      }
      return customerDetails(saved.id, saved.data());
    }
    if (data.contact && records.docs.some(doc => contactKey(doc.data().contact) === contactKey(data.contact))) {
      throw new ProductCreationError(409, 'A customer with this mobile number already exists.');
    }
    const code = records.docs.reduce((max, doc) => {
      const value = doc.data().code;
      return typeof value === 'number' && Number.isSafeInteger(value) && value > max ? value : max;
    }, 0) + 1;
    if (!Number.isSafeInteger(code)) throw new ProductCreationError(409, 'A customer code cannot be allocated.');
    // Only the existing customer document is created. Old Balance is the initial
    // numeric balance; no ledger, payment, bill or financial transaction is written.
    const fields = { ...data, id: documentId, code, selected: false, outletId: null };
    transaction.create(collection.doc(documentId), fields);
    return customerDetails(documentId, fields);
  });
}

export async function updateOutletCustomer(db: Firestore, outletId: string, documentId: string, profileId: string | null,
  assigned: Assignments, raw: unknown) {
  if (!profileId) throw new ProductCreationError(401, 'Your session has expired. Please sign in again.');
  if (![outletId, documentId].every(id => id && id.length <= 200 && !id.includes('/') && id !== '.' && id !== '..')) {
    throw new ProductCreationError(400, 'A valid outlet and customer are required.');
  }
  const parsed = customerSchema.omit({ requestId: true }).partial().strict().safeParse(raw);
  if (!parsed.success) throw new ProductCreationError(422, parsed.error.issues[0]?.message || 'Check the customer details.');
  const outlet = db.collection('OUTLET').doc(outletId), reference = outlet.collection('CUSTOMER').doc(documentId);
  return db.runTransaction(async transaction => {
    requireProductOutlet(profileId, outletId, (await transaction.get(db.collection('USER_PROFILE').doc(profileId))).data(), assigned);
    if ((await transaction.get(outlet)).data()?.active !== true) throw new ProductCreationError(403, 'This outlet is inactive or unavailable.');
    const record = await transaction.get(reference);
    if (!record.exists) throw new ProductCreationError(404, 'This customer no longer exists.');
    const stored = record.data()!;
    if (parsed.data.contact && contactKey(parsed.data.contact) !== contactKey(stored.contact)) {
      const customers = await transaction.get(outlet.collection('CUSTOMER'));
      if (customers.docs.some(doc => doc.id !== documentId && contactKey(doc.data().contact) === contactKey(parsed.data.contact))) {
        throw new ProductCreationError(409, 'A customer with this mobile number already exists.');
      }
    }
    if (Object.keys(parsed.data).length) transaction.update(reference, parsed.data);
    return customerDetails(documentId, { ...stored, ...parsed.data });
  });
}
