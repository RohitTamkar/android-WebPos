import type { Firestore } from 'firebase-admin/firestore';
export declare class CategoryUpdateError extends Error {
    status: number;
    constructor(status: number, message: string);
}
export declare function updateCategoryNames(db: Firestore, outletId: string, id: string, profileId: string | null, assignedOutlets: (profile: Record<string, unknown>) => string[], raw: unknown): Promise<{
    name: string;
    regionalName: string;
    id: string;
}>;
//# sourceMappingURL=categoryUpdate.d.ts.map