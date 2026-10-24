import { ProductCreationError, requireProductOutlet } from './productCreation.js';
// Read the existing outlet feature setting. Registered devices and billing
// shifts are not a configured list of counter names/numbers and must not be
// returned as one. No such counter-list model exists in this checkout.
export async function readOutletMulticounter(db, outletId, profileId, assignedOutlets) {
    requireProductOutlet(profileId, outletId, profileId ? (await db.collection('USER_PROFILE').doc(profileId).get()).data() : undefined, assignedOutlets);
    const outlet = await db.collection('OUTLET').doc(outletId).get();
    if (!outlet.exists)
        throw new ProductCreationError(404, 'Outlet not found.');
    const fields = outlet.data();
    return { outletName: typeof fields.name === 'string' ? fields.name : '',
        multiCounter: typeof fields.multiCounter === 'boolean' ? fields.multiCounter : null };
}
//# sourceMappingURL=multicounter.js.map