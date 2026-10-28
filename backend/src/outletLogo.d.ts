import type { Request, RequestHandler } from 'express';
import type { Firestore } from 'firebase-admin/firestore';
import { type MasterImageStorageBucket } from './imageStorage.js';
export declare function createOutletLogoHandler(deps: {
    readToken: (req: Request) => {
        profileDocId: string;
    } | null;
    db: () => Firestore;
    bucket: () => MasterImageStorageBucket;
    assigned: (profile: Record<string, unknown>) => string[];
}, action?: 'read' | 'upload' | 'remove'): RequestHandler;
//# sourceMappingURL=outletLogo.d.ts.map