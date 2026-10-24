import type { Firestore } from 'firebase-admin/firestore';
export declare function verifyTransferPreviewPin(db: Firestore, sourceOutletId: string, profileId: string | null, assigned: (profile: Record<string, unknown>) => string[], raw: unknown): Promise<{
    verified: boolean;
    destinationOutletId: string;
}>;
//# sourceMappingURL=transferPreviewPin.d.ts.map