import type { Firestore } from 'firebase-admin/firestore';
export declare class UserAccountError extends Error {
    status: number;
    constructor(status: number, message: string);
}
export declare function readUserAccount(db: Firestore, profileDocId: string): Promise<{
    name: string | null;
    email: string | null;
    loginPin: string | null;
    hasLoginPin: boolean;
}>;
export declare function updateUserAccount(db: Firestore, profileDocId: string, raw: unknown): Promise<{
    name: string | null;
    email: string | null;
    loginPin: string | null;
    hasLoginPin: boolean;
}>;
//# sourceMappingURL=userAccount.d.ts.map