import type { Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';
import type { PremisesTransactionRunner } from './premises.js';
export declare const receiptSupplierSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    mobile: z.ZodString;
    address: z.ZodString;
    alternateNumber: z.ZodNull;
    email: z.ZodString;
    gstin: z.ZodString;
}, z.core.$strict>;
type Assigned = (profile: Record<string, unknown>) => string[];
export declare function loadGoodsReceived(db: Firestore, outletId: string, profileId: string | null, assigned: Assigned): Promise<{
    documentId: string;
    supplierDraftId: string;
    suppliers: {
        name: string;
        mobile: string;
        address: string;
        email: string;
        gstin: string;
        id: string;
        alternateNumber: null;
    }[];
    receipts: {
        documentId: string;
        fields: FirebaseFirestore.DocumentData;
    }[];
}>;
export declare function saveGoodsReceived(run: PremisesTransactionRunner, outletId: string, profileId: string | null, assigned: Assigned, raw: unknown, clock?: () => Date): Promise<{
    documentId: string;
    alreadySaved: boolean;
}>;
export {};
//# sourceMappingURL=goodsReceived.d.ts.map