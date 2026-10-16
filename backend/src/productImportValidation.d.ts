export declare const PRODUCT_IMPORT_WRITES_ENABLED = true;
export interface ImportCategory {
    id: string;
    name: string;
    categoryNo: number | null;
}
export interface ImportTax {
    percent: number;
    index: number;
    type: number;
}
export interface ImportIssue {
    column: string;
    message: string;
}
export interface ImportDocument {
    rowNumber: number;
    fields: Record<string, string | number | boolean>;
    sourceIdentity?: string;
}
export declare function productIdentity(fields: Record<string, unknown>): string;
export declare function validateProductImport(source: string, categories: ImportCategory[], taxes?: ImportTax[]): {
    canUpload: boolean;
    categoryChecked: boolean;
    headerErrors: string[];
    rows: {
        rowNumber: number;
        errors: import("../../frontend/src/pages/productCsvPreview.js").RowIssue[];
    }[];
    documents: ImportDocument[];
};
export interface ImportValidationDependencies {
    readProfile: (id: string) => Promise<Record<string, unknown> | undefined>;
    assignedOutlets: (profile: Record<string, unknown>) => string[];
    readCategories: (outletId: string) => Promise<ImportCategory[]>;
    readTaxes: () => Promise<ImportTax[]>;
    readProducts: (outletId: string) => Promise<StoredImportProduct[]>;
}
export declare function checkAuthorizedProductImport(profileId: string | null, outletId: string, source: unknown, deps: ImportValidationDependencies): Promise<{
    status: number;
    body: {
        success: boolean;
        message: string;
        data?: never;
    };
} | {
    status: number;
    body: {
        message?: never;
        success: boolean;
        data: {
            canUpload: boolean;
            categoryChecked: boolean;
            headerErrors: string[];
            rows: {
                rowNumber: number;
                errors: import("../../frontend/src/pages/productCsvPreview.js").RowIssue[];
            }[];
            documents: ImportDocument[];
        };
    };
}>;
export interface StoredImportProduct {
    id: string;
    fields: Record<string, unknown>;
}
export declare function numericSearchCode(value: unknown): number | null;
export declare function nextProductCode(existing: StoredImportProduct[]): number;
export declare function allocateProductCodes(outletId: string, documents: ImportDocument[], existing: StoredImportProduct[]): ImportDocument[];
export declare function assertPreviewCodes(expected: ImportDocument[], actual: ImportDocument[]): void;
export interface ImportWriter {
    enabled: boolean;
    readExisting: (outletId: string) => Promise<StoredImportProduct[]>;
    createChunk: (outletId: string, documents: ImportDocument[]) => Promise<{
        created: number;
        existing: number;
    }>;
}
export declare function persistProductImport(outletId: string, documents: ImportDocument[], writer: ImportWriter): Promise<{
    success: boolean;
    created: number;
    existing: number;
    confirmedRows: number[];
    unconfirmedRows: number[];
    message: string;
}>;
//# sourceMappingURL=productImportValidation.d.ts.map