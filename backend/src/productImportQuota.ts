export const MAX_PRODUCT_UPLOAD_ATTEMPTS = 2;
export const PRODUCT_UPLOAD_WINDOW_MS = 24 * 60 * 60 * 1000;

export class ProductImportQuotaError extends Error {
  readonly nextAvailableAt: string;
  readonly retryAfterSeconds: number;

  constructor(nextAvailableAt: number, now: number) {
    const next = new Date(nextAvailableAt).toISOString();
    super(`Upload limit reached. This outlet allows only ${MAX_PRODUCT_UPLOAD_ATTEMPTS} upload attempts within 24 hours. Please try again at ${next}, when a 24-hour slot becomes available.`);
    this.name = 'ProductImportQuotaError';
    this.nextAvailableAt = next;
    this.retryAfterSeconds = Math.max(1, Math.ceil((nextAvailableAt - now) / 1000));
  }
}

/** Call after user/outlet authorization, before processing each upload attempt. */
export function createProductImportQuota(storage: {
  read(): Map<string, number[]>;
  write(outlets: Map<string, number[]>): void;
  exclusive<T>(operation: () => T): T;
}, now: () => number = Date.now) {
  const available = (outletId: string) => {
    const timestamp = now();
    if (!Number.isFinite(timestamp)) throw new Error('Unable to verify product import quota time.');
    if (!outletId) throw new Error('An authorized outlet is required.');
    const outlets = storage.read();
    // Synchronous check and reservation prevent concurrent requests exceeding capacity.
    for (const [id, attempts] of outlets) {
      const active = attempts.filter(at => timestamp - at < PRODUCT_UPLOAD_WINDOW_MS);
      if (active.length) outlets.set(id, active);
      else outlets.delete(id);
    }
    const attempts = outlets.get(outletId) ?? [];
    if (attempts.length >= MAX_PRODUCT_UPLOAD_ATTEMPTS) {
      throw new ProductImportQuotaError(Math.min(...attempts) + PRODUCT_UPLOAD_WINDOW_MS, timestamp);
    }
    return { outlets, attempts, timestamp };
  };
  return {
    check(outletId: string) {
      const { attempts } = available(outletId);
      return { remainingAttempts: MAX_PRODUCT_UPLOAD_ATTEMPTS - attempts.length, maxAttempts: MAX_PRODUCT_UPLOAD_ATTEMPTS };
    },
    accept(outletId: string): void {
      storage.exclusive(() => {
        const { outlets, attempts, timestamp } = available(outletId);
        attempts.push(timestamp);
        outlets.set(outletId, attempts);
        // Persist acceptance before validation or any product write can begin.
        storage.write(outlets);
      });
    },
  };
}

/** Isolated memory store for tests; the running server uses the file store. */
export function createInMemoryProductImportQuota(now: () => number = Date.now) {
  const outlets = new Map<string, number[]>();
  return createProductImportQuota({ read: () => outlets, write: () => {}, exclusive: operation => operation() }, now);
}
