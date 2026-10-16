import { z } from 'zod';
import type { Firestore } from 'firebase-admin/firestore';
export class CategoryUpdateError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const namesSchema = z.object({
  name: z.string().trim().min(1, 'Category Name is required.').max(200),
  regionalName: z.string().trim().max(200),
}).strict();

export async function updateCategoryNames(db: Firestore, outletId: string, id: string, profileId: string | null,
  assignedOutlets: (profile: Record<string, unknown>) => string[], raw: unknown) {
  if (!profileId) throw new CategoryUpdateError(401, 'Your session has expired. Please sign in again.');
  if (![outletId, id].every(value => value && !value.includes('/') && value !== '.' && value !== '..')) {
    throw new CategoryUpdateError(400, 'A valid outlet and category ID are required.');
  }
  const collection = db.collection('OUTLET').doc(outletId).collection('CATEGORY');
  return db.runTransaction(async transaction => {
    const profile = (await transaction.get(db.collection('USER_PROFILE').doc(profileId))).data();
    if (!profile || profile.active !== true || !assignedOutlets(profile).includes(outletId)) {
      throw new CategoryUpdateError(403, 'You do not have access to this outlet.');
    }
    const parsed = namesSchema.safeParse(raw);
    if (!parsed.success) throw new CategoryUpdateError(422, parsed.error.issues[0]?.message ?? 'Only category names can be updated.');
    const snapshot = await transaction.get(collection);
    if (!snapshot.docs.some(doc => doc.id === id)) throw new CategoryUpdateError(404, 'This category no longer exists.');
    if (snapshot.docs.some(doc => doc.id !== id && typeof doc.data().name === 'string'
      && (doc.data().name as string).trim().toLowerCase() === parsed.data.name.toLowerCase())) {
      throw new CategoryUpdateError(409, 'A category with this name already exists.');
    }
    // Intentionally update only these two existing fields. Number, ID, flags and all other data stay intact.
    transaction.update(collection.doc(id), { name: parsed.data.name, regionalName: parsed.data.regionalName });
    return { id, ...parsed.data };
  });
}
