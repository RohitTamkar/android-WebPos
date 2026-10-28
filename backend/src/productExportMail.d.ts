export interface ProductMailAttachment {
    buffer: Buffer;
    filename: string;
}
export declare function sendProductExportEmail(email: string, attachment: ProductMailAttachment, config?: {
    apiKey: string | undefined;
    from: string | undefined;
}, request?: typeof fetch): Promise<string>;
//# sourceMappingURL=productExportMail.d.ts.map