import { type Firestore } from 'firebase-admin/firestore';
import { type ImportDocument } from './productImportValidation.js';
export declare function createProductImportChunk(db: Firestore, outletId: string, documents: ImportDocument[]): Promise<{
    created: number;
    existing: number;
}>;
//# sourceMappingURL=productImportWriter.d.ts.map