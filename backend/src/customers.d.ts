import type { Firestore } from 'firebase-admin/firestore';
type Assignments = (profile: Record<string, unknown>) => string[];
export declare function customerDetails(documentId: string, fields: Record<string, unknown>): {
    documentId: string;
    name: string;
    contact: string;
    altContact: string;
    email: string;
    gstNo: string;
    address: string;
    creditLimit: number;
    dayLimit: number;
    balance: number;
    birthdayDate: string;
    anniversaryDate: string;
    allowedCredit: boolean;
};
export declare function listOutletCustomers(db: Firestore, outletId: string, profileId: string | null, assigned: Assignments): Promise<{
    customers: {
        documentId: string;
        name: string;
        contact: string;
        altContact: string;
        email: string;
        gstNo: string;
        address: string;
        creditLimit: number;
        dayLimit: number;
        balance: number;
        birthdayDate: string;
        anniversaryDate: string;
        allowedCredit: boolean;
    }[];
}>;
export declare function createOutletCustomer(db: Firestore, outletId: string, profileId: string | null, assigned: Assignments, raw: unknown): Promise<{
    documentId: string;
    name: string;
    contact: string;
    altContact: string;
    email: string;
    gstNo: string;
    address: string;
    creditLimit: number;
    dayLimit: number;
    balance: number;
    birthdayDate: string;
    anniversaryDate: string;
    allowedCredit: boolean;
}>;
export {};
//# sourceMappingURL=customers.d.ts.map