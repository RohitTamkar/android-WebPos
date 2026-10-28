import type { Firestore } from 'firebase-admin/firestore';
type Assignments = (profile: Record<string, unknown>) => string[];
export declare function servicePointDetails(documentId: string, fields: Record<string, unknown>): {
    documentId: string;
    name: string;
    paperSize: number | null;
    printerType: number | null;
    header: string;
    subHeader: string;
    footer: string;
    printerIpAddress: string;
    port: number | null;
    usbPath: string | null;
};
export declare function listOutletServicePoints(db: Firestore, outletId: string, profileId: string | null, assigned: Assignments): Promise<{
    servicePoints: {
        documentId: string;
        name: string;
        paperSize: number | null;
        printerType: number | null;
        header: string;
        subHeader: string;
        footer: string;
        printerIpAddress: string;
        port: number | null;
        usbPath: string | null;
    }[];
}>;
export declare function createOutletServicePoint(db: Firestore, outletId: string, profileId: string | null, assigned: Assignments, raw: unknown): Promise<{
    documentId: string;
    name: string;
    paperSize: number | null;
    printerType: number | null;
    header: string;
    subHeader: string;
    footer: string;
    printerIpAddress: string;
    port: number | null;
    usbPath: string | null;
}>;
export declare function updateOutletServicePoint(db: Firestore, outletId: string, documentId: string, profileId: string | null, assigned: Assignments, raw: unknown): Promise<{
    documentId: string;
    name: string;
    paperSize: number | null;
    printerType: number | null;
    header: string;
    subHeader: string;
    footer: string;
    printerIpAddress: string;
    port: number | null;
    usbPath: string | null;
}>;
export declare function deleteOutletServicePoint(db: Firestore, outletId: string, documentId: string, profileId: string | null, assigned: Assignments): Promise<{
    documentId: string;
}>;
export declare function assignCategoryServicePoint(db: Firestore, outletId: string, profileId: string | null, assigned: Assignments, raw: unknown): Promise<{
    categoryId: string;
    servicePointId: string;
    assignedCount: number;
    updatedCount: number;
}>;
export {};
//# sourceMappingURL=servicePoints.d.ts.map