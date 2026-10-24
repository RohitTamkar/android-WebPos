import type { Firestore } from 'firebase-admin/firestore';
export declare function listOutletDevices(db: Firestore, outletId: string, profileId: string | null, assignedOutlets: (profile: Record<string, unknown>) => string[]): Promise<{
    outletName: string;
    devices: {
        documentId: string;
        outletName: string;
        deviceId: string;
        active: boolean | null;
    }[];
}>;
//# sourceMappingURL=devices.d.ts.map