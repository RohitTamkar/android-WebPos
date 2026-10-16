import type { Firestore } from 'firebase-admin/firestore';
export declare class OutletDeletionError extends Error {
    status: number;
    constructor(status: number, message: string);
}
export declare function deleteOutletRecord(db: Firestore, outletId: string, collection: 'CATEGORY' | 'PRODUCT', documentId: string, profileId: string | null, assignedOutlets: (profile: Record<string, unknown>) => string[]): Promise<{
    id: string;
    deleted: boolean;
}>;
//# sourceMappingURL=outletDeletion.d.ts.map