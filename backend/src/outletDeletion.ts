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
