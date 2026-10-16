export declare const PRODUCT_COLUMNS: readonly ['Product Name', 'Regional Name', 'Default Price', 'Price 1', 'MRP Price', 'Purchase Price', 'Category Name', 'Category No', 'Tax', 'Barcode', 'Unit Type', 'Stock', 'Weightable', 'Search Code'];
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
export declare function fileSelectionError(name: string, size: number): string | null;
export declare function parseProductCsv(source: string): CsvPreview;
//# sourceMappingURL=productCsvPreview.d.ts.map