import type { Firestore } from 'firebase-admin/firestore';
export declare function readOutletMulticounter(db: Firestore, outletId: string, profileId: string | null, assignedOutlets: (profile: Record<string, unknown>) => string[]): Promise<{
    outletName: string;
    multiCounter: boolean | null;
}>;
//# sourceMappingURL=multicounter.d.ts.map