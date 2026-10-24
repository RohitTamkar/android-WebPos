import { z } from 'zod';
import { createHash } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { ProductCreationError, requireProductOutlet } from './productCreation.js';

// Observed Android schema: OUTLET/{outletId}/EMPLOYEE/{autoId}. The same
// collection supplies employees, captains and salesmen; there is no type field.
const employeeSchema = z.object({
  requestId: z.uuid(),
  name: z.string().trim().min(1, 'Employee Name is required.').max(200),
  mobile: z.string().trim().min(1, 'Mobile is required.').max(30).regex(/^\+?(?=.*\d)[\d ()-]+$/, 'Enter a valid mobile number.'),
  searchCode: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  shortName: z.string().trim().min(1, 'Short name is required.').max(200),
  balanceAmt: z.string().trim().regex(/^-?\d+(?:\.\d{1,2})?$/, 'Enter a valid balance.').refine(value => Number.isFinite(Number(value))),
  dateOfJoining: z.union([z.literal(''), z.iso.date()]),
  userId: z.string().max(200).refine(value => !value.includes('/')),
}).strict();
const text = (v: unknown) => typeof v === 'string' ? v : '';
const mobileKey = (v: unknown) => text(v).replace(/\D/g, '');
type Assignments = (profile: Record<string, unknown>) => string[];

export function employeeDetails(documentId: string, fields: Record<string, unknown>) {
  return { documentId, name: text(fields.name), mobile: text(fields.mobile),
    searchCode: typeof fields.searchCode === 'number' ? fields.searchCode : null,
    shortName: text(fields.shortName), balanceAmt: text(fields.balanceAmt),
    dateOfJoining: text(fields.dateOfJoining), userId: text(fields.userId) };
}

export async function listOutletEmployees(db: Firestore, outletId: string, profileId: string | null, assigned: Assignments) {
  requireProductOutlet(profileId, outletId, profileId ? (await db.collection('USER_PROFILE').doc(profileId).get()).data() : undefined, assigned);
  const outlet = db.collection('OUTLET').doc(outletId);
  if (!(await outlet.get()).exists) throw new ProductCreationError(404, 'Outlet not found.');
  const [records, ...profileGroups] = await Promise.all([
    outlet.collection('EMPLOYEE').get(),
    ...(['outlets', 'outletList', 'outletId'] as const).map(field => db.collection('USER_PROFILE')
      .where(field, field === 'outletId' ? '==' : 'array-contains', outletId)
      .select('name', 'active', 'outlets', 'outletList', 'outletId').get()),
  ]);
  const profiles = [...new Map(profileGroups.flatMap(group => group.docs).map(doc => [doc.id, doc])).values()];
  const employees = records.docs.map(doc => employeeDetails(doc.id, doc.data()))
    .sort((a, b) => (a.searchCode ?? Infinity) - (b.searchCode ?? Infinity) || a.name.localeCompare(b.name));
  return { employees, nextSearchCode: Math.max(0, ...employees.map(row => row.searchCode ?? 0)) + 1,
    userAccounts: profiles.filter(doc => doc.data().active === true && assigned(doc.data()).includes(outletId))
      .map(doc => ({ userId: doc.id, name: text(doc.data().name) })).sort((a, b) => a.name.localeCompare(b.name)) };
}

export async function createOutletEmployee(db: Firestore, outletId: string, profileId: string | null, assigned: Assignments, raw: unknown) {
  if (!profileId) throw new ProductCreationError(401, 'Your session has expired. Please sign in again.');
  if (!outletId || outletId.includes('/')) throw new ProductCreationError(400, 'A valid outlet is required.');
  const parsed = employeeSchema.safeParse(raw);
  if (!parsed.success) throw new ProductCreationError(422, parsed.error.issues[0]?.message || 'Check the employee details.');
  const { requestId, ...data } = parsed.data;
  const outlet = db.collection('OUTLET').doc(outletId);
  const collection = outlet.collection('EMPLOYEE');
  // Stable 20-character document ID makes retries safe without adding schema fields.
  // Scope it to the creator to prevent one user's request from retrieving another's result.
  const documentId = createHash('sha256').update(`${profileId}:${requestId}`).digest('hex').slice(0, 20);
  return db.runTransaction(async transaction => {
    const profile = await transaction.get(db.collection('USER_PROFILE').doc(profileId));
    requireProductOutlet(profileId, outletId, profile.data(), assigned);
    if (!(await transaction.get(outlet)).exists) throw new ProductCreationError(404, 'Outlet not found.');
    const records = await transaction.get(collection);
    if (data.userId) {
      const account = (await transaction.get(db.collection('USER_PROFILE').doc(data.userId))).data();
      if (!account || account.active !== true || !assigned(account).includes(outletId)) {
        throw new ProductCreationError(422, 'Select an active user account assigned to this outlet.');
      }
    }
    const saved = records.docs.find(doc => doc.id === documentId);
    if (saved) {
      const existing = saved.data();
      if (Object.entries(data).some(([key, value]) => existing[key] !== value)) {
        throw new ProductCreationError(409, 'This save request already created a different employee. Reload the list.');
      }
      return employeeDetails(saved.id, existing);
    }
    if (records.docs.some(doc => doc.data().searchCode === data.searchCode)) {
      throw new ProductCreationError(409, 'This search code is already in use. Choose another code or reload the list.');
    }
    if (records.docs.some(doc => mobileKey(doc.data().mobile) === mobileKey(data.mobile))) {
      throw new ProductCreationError(409, 'An employee with this mobile number already exists. Select the existing employee.');
    }
    const fields = { ...data, id: documentId, allowadvancepayment: false };
    transaction.create(collection.doc(documentId), fields);
    return employeeDetails(documentId, fields);
  });
}
