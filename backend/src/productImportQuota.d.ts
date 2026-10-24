export declare const MAX_PRODUCT_UPLOAD_ATTEMPTS = 2;
export declare const PRODUCT_UPLOAD_WINDOW_MS: number;
export declare class ProductImportQuotaError extends Error {
    readonly nextAvailableAt: string;
    readonly retryAfterSeconds: number;
    constructor(nextAvailableAt: number, now: number);
}
/** Call after user/outlet authorization, before processing each upload attempt. */
export declare function createProductImportQuota(storage: {
    read(): Map<string, number[]>;
    write(outlets: Map<string, number[]>): void;
    exclusive<T>(operation: () => T): T;
}, now?: () => number): {
    check(outletId: string): {
        remainingAttempts: number;
        maxAttempts: number;
    };
    accept(outletId: string): void;
};
/** Isolated memory store for tests; the running server uses the file store. */
export declare function createInMemoryProductImportQuota(now?: () => number): {
    check(outletId: string): {
        remainingAttempts: number;
        maxAttempts: number;
    };
    accept(outletId: string): void;
};
//# sourceMappingURL=productImportQuota.d.ts.map