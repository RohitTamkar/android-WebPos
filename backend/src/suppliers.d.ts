import type { PremisesTransactionRunner } from './premises.js';
export declare function receiptSupplierFromMaster(documentId: string, fields: Record<string, unknown> | undefined): {
    name: string;
    mobile: string;
    address: string;
    email: string;
    gstin: string;
    id: string;
    alternateNumber: null;
} | null;
export declare function createOutletSupplier(run: PremisesTransactionRunner, outletId: string, profileId: string | null, assigned: (profile: Record<string, unknown>) => string[], raw: unknown): Promise<{
    documentId: string;
    fields: {
        name: string;
        mobile: string;
        address: string;
        alternateNumber: string;
        email: string;
        gstin: string;
        id: null;
    };
    alreadySaved: boolean;
}>;
//# sourceMappingURL=suppliers.d.ts.map