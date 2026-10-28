import { type Firestore } from 'firebase-admin/firestore';
import { type ImportDocument } from './productImportValidation.js';
export declare function createProductImportChunk(db: Firestore, outletId: string, documents: ImportDocument[], premises?: {
    names: string[];
    profileId: string;
    assigned: (profile: Record<string, unknown>) => string[];
}): Promise<{
    created: number;
    existing: number;
}>;
//# sourceMappingURL=productImportWriter.d.ts.map