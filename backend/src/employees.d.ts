import type { Firestore } from 'firebase-admin/firestore';
type Assignments = (profile: Record<string, unknown>) => string[];
export declare function employeeDetails(documentId: string, fields: Record<string, unknown>): {
    documentId: string;
    name: string;
    mobile: string;
    searchCode: number | null;
    shortName: string;
    balanceAmt: string;
    dateOfJoining: string;
    userId: string;
};
export declare function listOutletEmployees(db: Firestore, outletId: string, profileId: string | null, assigned: Assignments): Promise<{
    employees: {
        documentId: string;
        name: string;
        mobile: string;
        searchCode: number | null;
        shortName: string;
        balanceAmt: string;
        dateOfJoining: string;
        userId: string;
    }[];
    nextSearchCode: number;
    userAccounts: {
        userId: string;
        name: string;
    }[];
}>;
export declare function createOutletEmployee(db: Firestore, outletId: string, profileId: string | null, assigned: Assignments, raw: unknown): Promise<{
    documentId: string;
    name: string;
    mobile: string;
    searchCode: number | null;
    shortName: string;
    balanceAmt: string;
    dateOfJoining: string;
    userId: string;
}>;
export {};
//# sourceMappingURL=employees.d.ts.map