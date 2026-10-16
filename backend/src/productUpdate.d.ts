import type { Firestore } from 'firebase-admin/firestore';
export declare function updateOutletProduct(db: Firestore, outletId: string, id: string, profileId: string | null, assignedOutlets: (profile: Record<string, unknown>) => string[], raw: unknown): Promise<{
    documentId: string;
    fields: {
        [x: string]: any;
    };
}>;
//# sourceMappingURL=productUpdate.d.ts.map