import type { Firestore } from 'firebase-admin/firestore';
export declare function deleteOutletMaster(db: Firestore, outletId: string, collection: 'PREMISES' | 'EMPLOYEE' | 'CUSTOMER', documentId: string, profileId: string | null, assigned: (profile: Record<string, unknown>) => string[]): Promise<{
    documentId: string;
    deleted: boolean;
}>;
//# sourceMappingURL=outletMasterDeletion.d.ts.map