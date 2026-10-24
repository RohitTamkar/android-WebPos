import type { Request, RequestHandler } from 'express';
import type { Firestore } from 'firebase-admin/firestore';
import { operateOutletDailyUsage } from './dailyUsage.js';
export declare function createWebUsageGuard(deps: {
    readToken: (req: Request) => {
        profileDocId: string;
    } | null;
    db: () => Firestore;
    assigned: (profile: Record<string, unknown>) => string[];
    operate: typeof operateOutletDailyUsage;
}): RequestHandler;
//# sourceMappingURL=webUsageMiddleware.d.ts.map