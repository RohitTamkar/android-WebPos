import { Timestamp } from 'firebase-admin/firestore';
import { requireProductOutlet } from './productCreation.js';
import { planImportPremises } from './productImportPremises.js';
import { allocateProductCodes, assertPreviewCodes } from './productImportValidation.js';
export async function createProductImportChunk(db, outletId, documents, premises) {
    const collection = db.collection('OUTLET').doc(outletId).collection('PRODUCT');
    return db.runTransaction(async (transaction) => {
        const outlet = db.collection('OUTLET').doc(outletId);
        let premiseCreates = [];
        if (premises) {
            const profile = (await transaction.get(db.collection('USER_PROFILE').doc(premises.profileId))).data();
            requireProductOutlet(premises.profileId, outletId, profile, premises.assigned);
            if ((await transaction.get(outlet)).data()?.active !== true)
                throw new Error('This outlet is inactive or unavailable.');
            const snapshot = await transaction.get(outlet.collection('PREMISES'));
            premiseCreates = planImportPremises(outletId, premises.profileId, premises.names, snapshot.docs.map(document => ({ id: document.id, fields: document.data() })), documents);
        }
        const categoryIds = [...new Set(documents.map(document => document.fields.category))];
        if (categoryIds.some(id => typeof id !== 'string' || !id || id.includes('/')))
            throw new Error('Product categories must be resolved before importing products.');
        const categories = await transaction.get(db.collection('OUTLET').doc(outletId).collection('CATEGORY'));
        if (categoryIds.some(id => !categories.docs.some(category => category.id === id)))
            throw new Error('A product category no longer exists. Resolve categories again before retrying.');
        // The full query participates in Firestore's serializable transaction, including
        // an empty outlet. Concurrent inserts cause allocation to retry against fresh data.
        const snapshot = await transaction.get(collection);
        const stored = snapshot.docs.map(document => ({ id: document.id, fields: document.data() }));
        const allocated = allocateProductCodes(outletId, documents, stored);
        assertPreviewCodes(documents, allocated);
        const savedIds = new Set(stored.map(document => document.id));
        for (const premise of premiseCreates)
            transaction.create(outlet.collection('PREMISES').doc(premise.id), premise.fields);
        let created = 0, existing = 0;
        for (const document of allocated) {
            if (savedIds.has(String(document.fields.id))) {
                existing++;
                continue;
            }
            transaction.create(collection.doc(String(document.fields.id)), { ...document.fields, dateTme: Timestamp.now() });
            created++;
        }
        return { created, existing };
    });
}
//# sourceMappingURL=productImportWriter.js.map