import { ProductCreationError, requireProductOutlet } from './productCreation.js';
export async function deleteOutletMaster(db, outletId, collection, documentId, profileId, assigned) {
    if (!profileId)
        throw new ProductCreationError(401, 'Your session has expired. Please sign in again.');
    if (![outletId, documentId].every(id => id && id.length <= 200 && !id.includes('/') && id !== '.' && id !== '..')
        || !['PREMISES', 'EMPLOYEE', 'CUSTOMER'].includes(collection))
        throw new ProductCreationError(400, 'A valid outlet and record are required.');
    const outlet = db.collection('OUTLET').doc(outletId);
    const reference = outlet.collection(collection).doc(documentId);
    return db.runTransaction(async (transaction) => {
        requireProductOutlet(profileId, outletId, (await transaction.get(db.collection('USER_PROFILE').doc(profileId))).data(), assigned);
        if ((await transaction.get(outlet)).data()?.active !== true)
            throw new ProductCreationError(403, 'This outlet is inactive or unavailable.');
        const record = await transaction.get(reference);
        // Only remove the selected master. Existing bills, balances in other records,
        // account logins, product prices and historical transactions remain intact.
        if (record.exists)
            transaction.delete(reference);
        return { documentId, deleted: record.exists };
    });
}
//# sourceMappingURL=outletMasterDeletion.js.map