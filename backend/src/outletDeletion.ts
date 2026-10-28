import type { Firestore } from 'firebase-admin/firestore';

export class OutletDeletionError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

// Deletes only the selected master document. No cascade, renumbering or schema changes.
export async function deleteOutletRecord(db: Firestore, outletId: string, collection: 'CATEGORY' | 'PRODUCT',
  documentId: string, profileId: string | null, assignedOutlets: (profile: Record<string, unknown>) => string[]) {
  if (!profileId) throw new OutletDeletionError(401, 'Your session has expired. Please sign in again.');
  if (![outletId, documentId].every(id => id && !id.includes('/') && id !== '.' && id !== '..')) {
    throw new OutletDeletionError(400, 'A valid outlet and record ID are required.');
  }
  if (collection !== 'CATEGORY' && collection !== 'PRODUCT') throw new OutletDeletionError(400, 'Invalid collection.');
  const reference = db.collection('OUTLET').doc(outletId).collection(collection).doc(documentId);
  return db.runTransaction(async transaction => {
    const profile = (await transaction.get(db.collection('USER_PROFILE').doc(profileId))).data();
    if (!profile || profile.active !== true || !assignedOutlets(profile).includes(outletId)) {
      throw new OutletDeletionError(403, 'You do not have access to this outlet.');
    }
    const snapshot = await transaction.get(reference);
    // Already absent is a successful retry (for example after a lost response).
    if (snapshot.exists) transaction.delete(reference);
    return { id: documentId, deleted: snapshot.exists };
  });
}

export const DELETE_ALL_CONFIRMATIONS = { PRODUCT: 'DELETE_ALL_PRODUCTS', CATEGORY: 'DELETE_ALL_CATEGORIES' } as const;
const BATCH_SIZE = 400;

// Deletes outlet masters after explicit confirmation. Product delete-all also
// removes that outlet's categories; category delete-all keeps products untouched.
// Batches commit independently, so a retry after a partial failure deletes whatever remains.
export async function deleteAllOutletRecords(db: Firestore, outletId: string, collection: 'CATEGORY' | 'PRODUCT',
  profileId: string | null, assignedOutlets: (profile: Record<string, unknown>) => string[], body: unknown): Promise<{ deleted: number; deletedCategories?: number }> {
  if (!profileId) throw new OutletDeletionError(401, 'Your session has expired. Please sign in again.');
  if (!outletId || outletId.includes('/') || outletId === '.' || outletId === '..') throw new OutletDeletionError(400, 'A valid outlet is required.');
  if (collection !== 'CATEGORY' && collection !== 'PRODUCT') throw new OutletDeletionError(400, 'Invalid collection.');
  const confirmation = body && typeof body === 'object' ? (body as Record<string, unknown>).confirm : undefined;
  if (confirmation !== DELETE_ALL_CONFIRMATIONS[collection]) throw new OutletDeletionError(400, 'Delete all must be confirmed.');
  const profile = (await db.collection('USER_PROFILE').doc(profileId).get()).data();
  if (!profile || profile.active !== true || !assignedOutlets(profile).includes(outletId)) {
    throw new OutletDeletionError(403, 'You do not have access to this outlet.');
  }
  const snapshot = await db.collection('OUTLET').doc(outletId).collection(collection).select().get();
  let deleted = 0;
  for (let start = 0; start < snapshot.docs.length; start += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = snapshot.docs.slice(start, start + BATCH_SIZE);
    chunk.forEach(document => batch.delete(document.ref));
    try { await batch.commit(); }
    catch { throw new OutletDeletionError(503, `${deleted} of ${snapshot.docs.length} deleted before an error. Retry Delete All to remove the rest.`); }
    deleted += chunk.length;
  }
  // The product delete-all action also clears the outlet's category masters.
  // Categories are reached only after every product batch has succeeded.
  if (collection === 'PRODUCT') {
    const categories = await deleteAllOutletRecords(db, outletId, 'CATEGORY', profileId, assignedOutlets,
      { confirm: DELETE_ALL_CONFIRMATIONS.CATEGORY });
    return { deleted, deletedCategories: categories.deleted };
  }
  return { deleted };
}
