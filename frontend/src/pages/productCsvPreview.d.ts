export declare const PRODUCT_COLUMNS: readonly ['Product Name', 'Regional Name', 'Default Price', 'Price 1', 'MRP Price', 'Purchase Price', 'Category Name', 'Category No', 'Tax', 'Barcode', 'Unit Type', 'Stock', 'Weightable', 'Search Code'];
export declare const PREMISES_PRODUCT_COLUMNS: readonly ["Product Name", "Regional Name", "Default Price", "Price 1", "MRP Price", "Purchase Price", "Category Name", "Category No", "Tax", "Barcode", "Unit Type", "Stock", "Weightable", "Search Code", "Premises"];
export declare const PREMISES_TEMPLATE_COLUMNS: readonly ["Product Name", "Regional Name", "Default Price", "Price 1", "MRP Price", "Purchase Price", "Category Name", "Category No", "Tax", "Barcode", "Unit Type", "Stock", "Weightable", "Search Code", "Premises 1", "Premises 2", "Premises 3"];
export type ProductUploadMode = 'standard' | 'premises';
export declare const PREMISES_IMPORT_LIMITATION = "Legacy Premises and numbered Premises columns remain preview-only. Use named premises price columns, such as AC Table and Non AC Table, to upload.";
export declare function namedPremisesHeaders(headers: readonly string[]): string[];
export declare const premisesPriceKey: (name: string) => string;
export declare const MAX_FILE_BYTES: number;
export declare const MAX_PRODUCT_ROWS = 10000;
export interface RowIssue {
    column: string;
    message: string;
}
export interface PreviewRow {
    rowNumber: number;
    cells: string[];
    errors: RowIssue[];
    warnings: RowIssue[];
}
export interface CsvPreview {
    headers: string[];
    headerRow: number;
    headerErrors: string[];
    delimiter: string;
    blankRows: number;
    rows: PreviewRow[];
}
export declare function fileSelectionError(name: string, size: number, mode?: ProductUploadMode): string | null;
export declare function parseProductCsv(source: string, mode?: ProductUploadMode): CsvPreview;
//# sourceMappingURL=productCsvPreview.d.ts.map