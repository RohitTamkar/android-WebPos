import type { Firestore } from 'firebase-admin/firestore';
export declare function updateProductPrices(db: Firestore, outletId: string, id: string, profileId: string | null, assigned: (profile: Record<string, unknown>) => string[], raw: unknown): Promise<{
    documentId: string;
    fields: {
        [x: string]: any;
    };
}>;
//# sourceMappingURL=productPriceUpdate.d.ts.map