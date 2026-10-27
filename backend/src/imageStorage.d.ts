import { type Firestore, type DocumentSnapshot } from 'firebase-admin/firestore';
type StorageBucket = {
    file(path: string): any;
};
export type MasterImageStorageBucket = StorageBucket;
export type MasterImageCollection = 'PRODUCT' | 'CATEGORY';
export type MasterImageKind = 'products' | 'categories';
import { PRODUCT_IMAGE_MAX_BYTES } from '../../shared/productImageLimits.js';
export { PRODUCT_IMAGE_MAX_BYTES };
declare const mimeExtension: Record<string, string>;
export declare class ImageStorageError extends Error {
    readonly status: number;
    constructor(status: number, message: string);
}
export declare function detectImage(bytes: Buffer): keyof typeof mimeExtension;
export declare function isMasterImagePath(path: unknown, kind: MasterImageKind, outletId: string, documentId: string): path is string;
export declare function productImageStoragePath(image: unknown): string | undefined;
export declare function resolveProductImagePath(fields: Record<string, unknown>, outletId: string, documentId: string): string | undefined;
export declare function verifyStorageCopy(bucket: StorageBucket, imagePath: string, expectedBytes: Buffer, expectedType: keyof typeof mimeExtension): Promise<boolean>;
export declare function verifyExistingProductImage(bucket: StorageBucket, image: unknown): Promise<boolean>;
export declare function copyMasterImageFromPath(bucket: StorageBucket, kind: MasterImageKind, sourceOutletId: string, sourceDocumentId: string, sourceImagePath: string, destinationOutletId: string, destinationDocumentId: string): Promise<{
    imagePath: string;
    sourceImagePath: string;
    contentType: string;
}>;
export declare function verifyMasterImageCopy(bucket: StorageBucket, kind: MasterImageKind, sourceOutletId: string, sourceDocumentId: string, sourceImagePath: string, destinationOutletId: string, destinationDocumentId: string, destinationImagePath: unknown): Promise<boolean>;
export declare function storeVerifiedProductImage(bucket: StorageBucket, filename: string, bytes: Buffer, contentType: string): Promise<void>;
export interface ProductImageUploadOperation {
    requestId: string;
    expectedReference: string | null;
}
export declare function uploadMasterImage(db: Firestore, bucket: StorageBucket, kind: MasterImageKind, outletId: string, documentId: string, bytes: Buffer, declaredType: string, operation?: ProductImageUploadOperation): Promise<{
    image: string;
    imagePath?: never;
} | {
    image?: never;
    imagePath: string;
}>;
export declare function readMasterImage(db: Firestore, bucket: StorageBucket, kind: MasterImageKind, outletId: string, documentId: string, authorizedSnapshot?: Pick<DocumentSnapshot, 'exists' | 'get'>): Promise<{
    bytes: Buffer<ArrayBufferLike>;
    contentType: string;
    imagePath: string;
}>;
export declare function copyMasterImage(db: Firestore, bucket: StorageBucket, kind: MasterImageKind, sourceOutletId: string, sourceDocumentId: string, destinationOutletId: string, destinationDocumentId: string): Promise<string>;
export declare function removeMasterImage(db: Firestore, kind: MasterImageKind, outletId: string, documentId: string, reviewed?: unknown): Promise<{
    removed: boolean;
}>;
//# sourceMappingURL=imageStorage.d.ts.map