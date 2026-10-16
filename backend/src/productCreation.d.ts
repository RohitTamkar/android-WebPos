import { z } from 'zod';
import { type Firestore } from 'firebase-admin/firestore';
import { type ImportTax } from './productImportValidation.js';
export declare const PRODUCT_UNITS: {
    id: number;
    name: string;
}[];
export declare const newProductSchema: z.ZodObject<{
    requestId: z.ZodUUID;
    code: z.ZodNumber;
    name: z.ZodString;
    price: z.ZodNumber;
    mrpPrice: z.ZodNumber;
    costPrice: z.ZodNumber;
    category: z.ZodString;
    regionalName: z.ZodDefault<z.ZodString>;
    discount: z.ZodNumber;
    shortName: z.ZodDefault<z.ZodString>;
    taxIndex: z.ZodNumber;
    hsnCode: z.ZodDefault<z.ZodString>;
    unitId: z.ZodNumber;
    weighable: z.ZodBoolean;
    stockable: z.ZodBoolean;
}, z.core.$strip>;
export declare class ProductCreationError extends Error {
    status: number;
    errors: Record<string, string>;
    nextCode?: number | undefined;
    constructor(status: number, message: string, errors?: Record<string, string>, nextCode?: number | undefined);
}
export declare function requireProductOutlet(profileId: string | null, outletId: string, profile: Record<string, unknown> | undefined, assignedOutlets: (profile: Record<string, unknown>) => string[]): void;
export declare function productTaxes(records: {
    percent?: unknown;
    index?: unknown;
    type?: unknown;
}[]): ImportTax[];
export declare function validateNewProduct(raw: unknown, categories: string[], taxes: ImportTax[]): {
    requestId: string;
    code: number;
    name: string;
    price: number;
    mrpPrice: number;
    costPrice: number;
    category: string;
    regionalName: string;
    discount: number;
    shortName: string;
    taxIndex: number;
    hsnCode: string;
    unitId: number;
    weighable: boolean;
    stockable: boolean;
};
export declare function validateProductReferences(data: {
    category: string;
    taxIndex: number;
    unitId: number;
}, categories: string[], taxes: ImportTax[]): void;
export declare function createOutletProduct(db: Firestore, outletId: string, profileId: string | null, assignedOutlets: (profile: Record<string, unknown>) => string[], raw: unknown): Promise<{
    documentId: string;
    fields: FirebaseFirestore.DocumentData;
}>;
//# sourceMappingURL=productCreation.d.ts.map