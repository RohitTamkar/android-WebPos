import { type Firestore } from 'firebase-admin/firestore';
import { type MasterImageStorageBucket } from './imageStorage.js';
export interface TransferItem {
    type: 'category' | 'product';
    sourceId: string;
    name: string;
    status: 'created' | 'already-transferred' | 'mapped' | 'skipped';
    reason: string;
    destinationId?: string;
    destinationNumber?: number;
}
export declare function issueTransferAuthorization(secret: string, profileId: string, sourceOutletId: string, destinationOutletId: string): string;
export declare function requireTransferAuthorization(secret: string, grant: string | undefined, profileId: string, source: string, destination: string): void;
export declare function transferOutletMasters(db: Firestore, sourceId: string, profileId: string | null, assigned: (profile: Record<string, unknown>) => string[], secret: string, grant: string | undefined, raw: unknown): Promise<{
    items: TransferItem[];
    created: number;
    skipped: number;
    unchanged: number;
}>;
export declare function transferOutletMastersWithStorage(db: Firestore, sourceId: string, profileId: string | null, assigned: (profile: Record<string, unknown>) => string[], secret: string, grant: string | undefined, raw: unknown, bucket: MasterImageStorageBucket): Promise<{
    items: TransferItem[];
    created: number;
    skipped: number;
    unchanged: number;
}>;
//# sourceMappingURL=masterTransfer.d.ts.map