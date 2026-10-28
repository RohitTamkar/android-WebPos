import type { Firestore } from 'firebase-admin/firestore';
export declare class OutletDeletionError extends Error {
    status: number;
    constructor(status: number, message: string);
}
export declare function deleteOutletRecord(db: Firestore, outletId: string, collection: 'CATEGORY' | 'PRODUCT', documentId: string, profileId: string | null, assignedOutlets: (profile: Record<string, unknown>) => string[]): Promise<{
    id: string;
    deleted: boolean;
}>;
export declare const DELETE_ALL_CONFIRMATIONS: {
    readonly PRODUCT: 'DELETE_ALL_PRODUCTS';
    readonly CATEGORY: 'DELETE_ALL_CATEGORIES';
};
export declare function deleteAllOutletRecords(db: Firestore, outletId: string, collection: 'CATEGORY' | 'PRODUCT', profileId: string | null, assignedOutlets: (profile: Record<string, unknown>) => string[], body: unknown): Promise<{
    deleted: number;
    deletedCategories?: number;
}>;
//# sourceMappingURL=outletDeletion.d.ts.map