import { type ImportValidationDependencies, type ImportWriter } from './productImportValidation.js';
import { type CategoryResolution } from './productImportCategories.js';
import { type ProductUploadMode } from '../../frontend/src/pages/productCsvPreview.js';
export declare function persistProductImportWithCategories(outletId: string, profileId: string, source: string, codes: unknown[], deps: ImportValidationDependencies, resolve: () => Promise<CategoryResolution>, writer: ImportWriter, mode?: ProductUploadMode): Promise<{
    success: boolean;
    created: number;
    existing: number;
    confirmedRows: number[];
    unconfirmedRows: number[];
    categoriesCreated: number;
    categoriesReused: number;
    failedRows: null;
    message: string;
} | {
    success: boolean;
    created: number;
    existing: number;
    confirmedRows: number[];
    unconfirmedRows: number[];
    categoriesCreated: number;
    categoriesReused: number;
    failedRows: number;
    message: string;
} | {
    success: boolean;
    created: number;
    existing: number;
    confirmedRows: number[];
    unconfirmedRows: number[];
    categoriesCreated: number;
    categoriesReused: number;
    failedRows: number;
    categoryFailures: import("./productImportCategories.js").CategoryImportIssue[];
    message: string;
}>;
//# sourceMappingURL=productImportFlow.d.ts.map