/** Local backend storage only. No Firebase access or product/customer data. */
export declare function createFileProductImportQuota(filename: string, now?: () => number): {
    check(outletId: string): {
        remainingAttempts: number;
        maxAttempts: number;
    };
    accept(outletId: string): void;
};
//# sourceMappingURL=productImportQuotaFile.d.ts.map