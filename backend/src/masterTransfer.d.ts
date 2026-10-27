import { type Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';
import { type MasterImageStorageBucket } from './imageStorage.js';
declare const requestSchema: z.ZodObject<{
    destinationOutletId: z.ZodString;
    mode: z.ZodEnum<{
        categories: "categories";
        products: "products";
    }>;
    categoryIds: z.ZodArray<z.ZodString>;
    products: z.ZodArray<z.ZodObject<{
        sourceProductId: z.ZodString;
        fields: z.ZodArray<z.ZodEnum<{
            barcode: "barcode";
            category: "category";
            costPrice: "costPrice";
            discount: "discount";
            hsnCode: "hsnCode";
            mrpPrice: "mrpPrice";
            name: "name";
            price: "price";
            regionalName: "regionalName";
            shortName: "shortName";
            stockable: "stockable";
            taxIndex: "taxIndex";
            unitId: "unitId";
            weighable: "weighable";
        }>>;
    }, z.core.$strict>>;
    categoryMappings: z.ZodRecord<z.ZodString, z.ZodString>;
    options: z.ZodDefault<z.ZodObject<{
        stock: z.ZodBoolean;
        weighable: z.ZodBoolean;
        images: z.ZodBoolean;
        taxes: z.ZodBoolean;
        prices: z.ZodBoolean;
        barcode: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type TransferOptions = z.infer<typeof requestSchema>['options'];
export interface TransferItem {
    type: 'category' | 'product';
    sourceId: string;
    name: string;
    status: 'created' | 'already-transferred' | 'mapped' | 'skipped';
    reason: string;
    destinationId?: string;
    destinationNumber?: number;
}
export declare function issueTransferAuthorization(secret: string, profileId: string, sourceOutletId: string, destinationOutletId: string): string;
export declare function requireTransferAuthorization(secret: string, grant: string | undefined, profileId: string, source: string, destination: string): void;
export declare function transferOutletMasters(db: Firestore, sourceId: string, profileId: string | null, assigned: (profile: Record<string, unknown>) => string[], secret: string, grant: string | undefined, raw: unknown): Promise<{
    items: TransferItem[];
    created: number;
    skipped: number;
    unchanged: number;
}>;
export declare function transferOutletMastersWithStorage(db: Firestore, sourceId: string, profileId: string | null, assigned: (profile: Record<string, unknown>) => string[], secret: string, grant: string | undefined, raw: unknown, bucket: MasterImageStorageBucket): Promise<{
    items: TransferItem[];
    created: number;
    skipped: number;
    unchanged: number;
}>;
export {};
//# sourceMappingURL=masterTransfer.d.ts.map