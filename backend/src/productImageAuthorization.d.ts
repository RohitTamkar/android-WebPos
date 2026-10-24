import type { Firestore } from 'firebase-admin/firestore';
export declare function verifyProductImagePin(db: Firestore, outletId: string, profileId: string | null, assigned: (profile: Record<string, unknown>) => string[], secret: string, session: string, raw: unknown): Promise<{
    verified: boolean;
    action: "bulk" | "remove" | "shared";
    imageToken: string;
}>;
export declare function requireProductImageAuthorization(secret: string, grant: string | undefined, profileId: string, outletId: string, session: string, actions: string[]): void;
//# sourceMappingURL=productImageAuthorization.d.ts.map