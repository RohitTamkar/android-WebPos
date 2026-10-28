import ExcelJS from 'exceljs';
export declare const PRODUCT_EXCEL_COLUMNS: string[];
export declare const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export interface ProductExportDependencies {
    readProfile(id: string): Promise<Record<string, unknown> | undefined>;
    assignedOutlets(profile: Record<string, unknown>): string[];
    readProducts(id: string): Promise<{
        id: string;
        fields: Record<string, unknown>;
    }[]>;
    readCategories(id: string): Promise<{
        id: string;
        name: string;
        categoryNo: number | null;
    }[]>;
    readPremises(id: string): Promise<{
        id: string;
        name: string;
    }[]>;
}
export declare function createProductExport(deps: ProductExportDependencies, outletId: string, profileId: string | null): Promise<{
    buffer: Buffer<ExcelJS.Buffer>;
    filename: string;
    count: number;
    warnings: number;
}>;
//# sourceMappingURL=productExcel.d.ts.map