import type { Firestore } from 'firebase-admin/firestore';
import { ProductCreationError, requireProductOutlet } from './productCreation.js';

// DEVICE is an existing root collection. Read only: activation/registration
// permissions and update behavior are not implemented in this web checkout.
export async function listOutletDevices(db: Firestore, outletId: string, profileId: string | null,
  assignedOutlets: (profile: Record<string, unknown>) => string[]) {
  requireProductOutlet(profileId, outletId,
    profileId ? (await db.collection('USER_PROFILE').doc(profileId).get()).data() : undefined, assignedOutlets);
  const outlet = await db.collection('OUTLET').doc(outletId).get();
  if (!outlet.exists) throw new ProductCreationError(404, 'Outlet not found.');
  const outletFields = outlet.data();
  const outletName = typeof outletFields?.name === 'string' ? outletFields.name : '';
  // Device documents also contain quickPin and location data. Project only
  // the fields needed for the outlet-scoped list; never return the raw document.
  const snapshot = await db.collection('DEVICE').where('outletId', '==', outletId)
    .select('deviceId', 'active', 'outletId').get();
  const devices = snapshot.docs.filter(doc => doc.data().outletId === outletId).map(doc => {
    const fields = doc.data();
    return { documentId: doc.id, outletName,
      deviceId: typeof fields.deviceId === 'string' && fields.deviceId ? fields.deviceId : doc.id,
      active: typeof fields.active === 'boolean' ? fields.active : null };
  }).sort((a, b) => a.deviceId.localeCompare(b.deviceId));
  return { outletName, devices };
}
