import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { allocateProductCodes, assertPreviewCodes, type ImportDocument } from './productImportValidation.js';

export async function createProductImportChunk(db: Firestore, outletId: string, documents: ImportDocument[]) {
  const collection = db.collection('OUTLET').doc(outletId).collection('PRODUCT');
  return db.runTransaction(async transaction => {
    // The full query participates in Firestore's serializable transaction, including
    // an empty outlet. Concurrent inserts cause allocation to retry against fresh data.
    const snapshot = await transaction.get(collection);
    const stored = snapshot.docs.map(document => ({ id: document.id, fields: document.data() }));
    const allocated = allocateProductCodes(outletId, documents, stored);
    assertPreviewCodes(documents, allocated);
    const savedIds = new Set(stored.map(document => document.id));
    let created = 0, existing = 0;
    for (const document of allocated) {
      if (savedIds.has(String(document.fields.id))) { existing++; continue; }
      transaction.create(collection.doc(String(document.fields.id)), { ...document.fields, dateTme: Timestamp.now() });
      created++;
    }
    return { created, existing };
  });
}
