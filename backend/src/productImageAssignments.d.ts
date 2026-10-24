import type { Firestore } from 'firebase-admin/firestore';
import { type MasterImageStorageBucket } from './imageStorage.js';
export interface ImageAssignmentResult {
    documentId: string;
    status: 'saved' | 'unchanged' | 'failed';
    message: string;
}
export declare function assignProductImage(db: Firestore, bucket: MasterImageStorageBucket, outletId: string, profileId: string, assigned: (profile: Record<string, unknown>) => string[], raw: unknown): Promise<{
    image: string;
    results: ImageAssignmentResult[];
}>;
//# sourceMappingURL=productImageAssignments.d.ts.map