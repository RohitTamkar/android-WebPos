import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { ProductCreationError } from './productCreation.js';
export declare const WEB_USAGE_LEASE_SECONDS = 30;
export declare class DailyUsageError extends ProductCreationError {
    code: string;
    constructor(status: number, code: string, message: string);
}
export declare function resolveUsageTimeZone(country: unknown, serverZone?: () => string): string;
export declare function initializeOutletDailyUsage(db: Firestore, outletId: string, profileId: string | null, assigned: (profile: Record<string, unknown>) => string[], raw?: unknown, clock?: () => Timestamp): Promise<{
    outletId: string;
    initialized: boolean;
    reset: boolean;
    date: string;
    timeZone: string;
    limitSeconds: number;
    usedSeconds: number;
} | {
    outletId: string;
    initialized: boolean;
    reset: boolean;
    date: string;
    timeZone: string;
    limitSeconds: number;
    usedSeconds: number;
    remainingSeconds: number;
    generation: string;
    sessionId?: string;
    expiresAt?: number;
    sequence?: number;
}>;
export declare function operateOutletDailyUsage(db: Firestore, outletId: string, profileId: string | null, assigned: (profile: Record<string, unknown>) => string[], raw: unknown, clock?: () => Timestamp): Promise<{
    outletId: string;
    initialized: boolean;
    reset: boolean;
    date: string;
    timeZone: string;
    limitSeconds: number;
    usedSeconds: number;
} | {
    outletId: string;
    initialized: boolean;
    reset: boolean;
    date: string;
    timeZone: string;
    limitSeconds: number;
    usedSeconds: number;
    remainingSeconds: number;
    generation: string;
    sessionId?: string;
    expiresAt?: number;
    sequence?: number;
}>;
//# sourceMappingURL=dailyUsage.d.ts.map