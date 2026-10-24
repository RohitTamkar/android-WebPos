import { createHash } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';
import { ProductCreationError, requireProductOutlet } from './productCreation.js';
import { ANDROID_TAX_OPTIONS } from '../../shared/androidTaxes.js';

type Assignments = (profile: Record<string, unknown>) => string[];
const pathId = z.string().min(1).max(200).refine(value => !value.includes('/') && value !== '.' && value !== '..');
const whole = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const schema = z.object({
  requestId: z.uuid(), name: z.string().trim().min(1).max(200), code: whole,
  type: z.enum(['Table', 'Room', 'Bill']), tables: whole, range: whole,
  taxIndex: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), userId: pathId,
  extraPriceFlag: z.boolean(), price: z.number().finite().nonnegative(),
}).strict();

export interface PremisesRecord { documentId: string; fields: Record<string, unknown> }
export type TypedFields = Record<string, { integerValue: string } | { doubleValue: number } |
  { stringValue: string } | { booleanValue: boolean } | { nullValue: null } | { timestampValue: string }>;
export interface PremisesTransaction {
  read(path: string): Promise<Record<string, unknown> | undefined>;
  list(path: string): Promise<PremisesRecord[]>;
  create(path: string, fields: TypedFields): void;
  update(path: string, fields: TypedFields): void;
}
export type PremisesTransactionRunner = <T>(work: (transaction: PremisesTransaction) => Promise<T>) => Promise<T>;

export function premiseFields(input: Omit<z.infer<typeof schema>, 'requestId'>, now: Date): TypedFields {
  // Explicit wire types preserve Android's int64/double distinction, including price 0.
  return {
    code: { integerValue: String(input.code) }, createdTime: { timestampValue: now.toISOString() },
    extraPriceFlag: { booleanValue: input.extraPriceFlag }, id: { nullValue: null },
    name: { stringValue: input.name }, price: { doubleValue: input.price },
    range: { integerValue: String(input.range) }, tables: { integerValue: String(input.tables) },
    taxIndex: { integerValue: String(input.taxIndex) }, type: { stringValue: input.type },
    userId: { stringValue: input.userId },
  };
}

export async function listOutletPremises(db: Firestore, outletId: string, profileId: string | null, assigned: Assignments) {
  if (!pathId.safeParse(outletId).success) throw new ProductCreationError(400, 'A valid outlet is required.');
  requireProductOutlet(profileId, outletId, profileId ? (await db.collection('USER_PROFILE').doc(profileId).get()).data() : undefined, assigned);
  const outlet = db.collection('OUTLET').doc(outletId);
  if (!(await outlet.get()).exists) throw new ProductCreationError(404, 'Outlet not found.');
  const [records, ...groups] = await Promise.all([
    outlet.collection('PREMISES').get(),
    ...(['outlets', 'outletList', 'outletId'] as const).map(field => db.collection('USER_PROFILE')
      .where(field, field === 'outletId' ? '==' : 'array-contains', outletId)
      .select('name', 'active', 'outlets', 'outletList', 'outletId').get()),
  ]);
  const premises = records.docs.map(doc => ({ documentId: doc.id, fields: doc.data() }))
    .sort((a, b) => String(a.fields.code ?? '').localeCompare(String(b.fields.code ?? ''), 'en', { numeric: true }));
  const codes = premises.map(row => row.fields.code).filter((code): code is number => typeof code === 'number' && Number.isSafeInteger(code));
  const accounts = [...new Map(groups.flatMap(group => group.docs).map(doc => [doc.id, doc])).values()];
  return { premises, nextCode: codes.reduce((max, code) => Math.max(max, code), 0) + 1,
    taxes: ANDROID_TAX_OPTIONS,
    userAccounts: accounts.filter(doc => doc.data().active === true && assigned(doc.data()).includes(outletId))
      .map(doc => ({ userId: doc.id, name: typeof doc.data().name === 'string' ? doc.data().name as string : doc.id })),
  };
}

export async function createOutletPremise(run: PremisesTransactionRunner, outletId: string, profileId: string | null,
  assigned: Assignments, raw: unknown) {
  if (!profileId) throw new ProductCreationError(401, 'Your session has expired. Please sign in again.');
  if (!pathId.safeParse(outletId).success) throw new ProductCreationError(400, 'A valid outlet is required.');
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new ProductCreationError(422, 'Enter a name, positive whole code/count/range, tax, user account and a non-negative price.');
  const { requestId, ...data } = parsed.data;
  const collection = `OUTLET/${outletId}/PREMISES`;
  const id = createHash('sha256').update(`${profileId}:${requestId}`).digest('hex').slice(0, 20);
  return run(async transaction => {
    requireProductOutlet(profileId, outletId, await transaction.read(`USER_PROFILE/${profileId}`), assigned);
    if (!await transaction.read(`OUTLET/${outletId}`)) throw new ProductCreationError(404, 'Outlet not found.');
    const records = await transaction.list(collection);
    const saved = records.find(row => row.documentId === id);
    if (saved) {
      if (Object.entries(data).some(([key, value]) => saved.fields[key] !== value)) {
        throw new ProductCreationError(409, 'This request already saved different premises. Reload the list.');
      }
      return saved;
    }
    if (records.some(row => row.fields.code === data.code)) throw new ProductCreationError(409, 'This premises code already exists. Choose another code.');
    const account = await transaction.read(`USER_PROFILE/${data.userId}`);
    if (!account || account.active !== true || !assigned(account).includes(outletId)) {
      throw new ProductCreationError(422, 'Select an active user account assigned to this outlet.');
    }
    if (!ANDROID_TAX_OPTIONS.some(tax => tax.index === data.taxIndex)) throw new ProductCreationError(422, 'Select an available GST or VAT tax.');
    const now = new Date();
    transaction.create(`${collection}/${id}`, premiseFields(data, now));
    return { documentId: id, fields: { ...data, id: null, createdTime: now.toISOString() } };
  });
}

const patchSchema = schema.omit({ requestId: true }).partial().strict();
export async function updateOutletPremise(run: PremisesTransactionRunner, outletId: string, id: string,
  profileId: string | null, assigned: Assignments, raw: unknown) {
  if (!profileId) throw new ProductCreationError(401, 'Your session has expired. Please sign in again.');
  if (![outletId, id].every(value => pathId.safeParse(value).success)) throw new ProductCreationError(400, 'A valid outlet and premises ID are required.');
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) throw new ProductCreationError(422, 'Check the premises details. Only editable fields can be updated.');
  const changes = Object.fromEntries(Object.entries(parsed.data).filter(([, value]) => value !== undefined));
  return run(async transaction => {
    requireProductOutlet(profileId, outletId, await transaction.read(`USER_PROFILE/${profileId}`), assigned);
    const path = `OUTLET/${outletId}/PREMISES/${id}`;
    const stored = await transaction.read(path);
    if (!stored) throw new ProductCreationError(404, 'This premise no longer exists.');
    if ('code' in changes && changes.code !== stored.code) {
      const others = await transaction.list(`OUTLET/${outletId}/PREMISES`);
      if (others.some(row => row.documentId !== id && row.fields.code === changes.code)) {
        throw new ProductCreationError(409, 'This premises code already exists. Choose another code.');
      }
    }
    if ('userId' in changes && changes.userId !== stored.userId) {
      const account = await transaction.read(`USER_PROFILE/${changes.userId}`);
      if (!account || account.active !== true || !assigned(account).includes(outletId)) {
        throw new ProductCreationError(422, 'Select an active user account assigned to this outlet.');
      }
    }
    if ('taxIndex' in changes && changes.taxIndex !== stored.taxIndex
      && !ANDROID_TAX_OPTIONS.some(tax => tax.index === changes.taxIndex)) {
      throw new ProductCreationError(422, 'Select an available GST or VAT tax.');
    }
    const fields: TypedFields = {};
    for (const [key, value] of Object.entries(changes)) {
      if (value === stored[key]) continue;
      if (['code', 'range', 'tables', 'taxIndex'].includes(key)) fields[key] = { integerValue: String(value) };
      else if (key === 'price') fields[key] = { doubleValue: value as number };
      else if (key === 'extraPriceFlag') fields[key] = { booleanValue: value as boolean };
      else fields[key] = { stringValue: value as string };
    }
    // A field mask preserves createdTime, id and all other existing fields/types.
    if (Object.keys(fields).length) transaction.update(path, fields);
    return { documentId: id, fields: { ...stored, ...changes } };
  });
}
