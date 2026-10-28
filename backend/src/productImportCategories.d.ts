import type { Firestore } from 'firebase-admin/firestore';
import { type ProductUploadMode } from '../../frontend/src/pages/productCsvPreview.js';
import type { ImportCategory } from './productImportValidation.js';
export declare const categoryNameKey: (name: string) => string;
export interface CategoryImportIssue {
    rowNumber: number;
    column: string;
    message: string;
}
export interface CategoryEntry {
    name: string;
    categoryNo: number;
    rows: number[];
    id?: string;
}
export declare function planImportCategories(source: string, existing: ImportCategory[], mode?: ProductUploadMode): {
    entries: CategoryEntry[];
    issues: CategoryImportIssue[];
    missing: CategoryEntry[];
    previewCategories: ImportCategory[];
    reused: number;
};
export interface CategoryResolution {
    success: boolean;
    categories: ImportCategory[];
    created: number;
    reused: number;
    issues: CategoryImportIssue[];
}
export declare function resolveImportCategories(db: Firestore, outletId: string, profileId: string | null, assigned: (profile: Record<string, unknown>) => string[], source: string, mode?: ProductUploadMode): Promise<CategoryResolution>;
//# sourceMappingURL=productImportCategories.d.ts.map