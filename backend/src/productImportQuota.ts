import { createHash } from 'node:crypto';

export const MAX_PRODUCT_EXCEL_UPLOADS = 2;
export const UPLOAD_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * TEMPORARY IN-MEMORY PROTOTYPE, NOT PRODUCTION-SAFE.
 * State resets on backend restart and is not shared across backend instances.
 * There is no database, file storage, or network access in this module.
 */
export class ProductImportQuotaError extends Error {
  readonly nextAvailableAt: string;
  readonly retryAfterSeconds: number;

  constructor(nextAvailableAt: number, now: number) {
    const next = new Date(nextAvailableAt).toISOString();
    super(`This outlet has reached the limit of ${MAX_PRODUCT_EXCEL_UPLOADS} product uploads within 24 hours. The next upload slot is available at ${next}.`);
    this.name = 'ProductImportQuotaError';
    this.nextAvailableAt = next;
    this.retryAfterSeconds = Math.max(1, Math.ceil((nextAvailableAt - now) / 1000));
  }
}

interface AcceptedImport {
  acceptedAt: number;
  pending?: Promise<unknown>;
  completed?: unknown;
}

/** Call only after the existing user/outlet authorization and import checks. */
export function createInMemoryProductImportQuota(now: () => number = Date.now) {
  const outlets = new Map<string, Map<string, AcceptedImport>>();

  return {
    run<T extends { success: boolean }>(outletId: string, validatedSource: string, importProducts: () => Promise<T>): Promise<T> {
      const timestamp = now();
      if (!Number.isFinite(timestamp)) throw new Error('Unable to verify product import quota time.');
      if (!outletId || typeof validatedSource !== 'string') throw new Error('An authorized outlet and validated import source are required.');

      // No await between checking and recording acceptance: this critical section
      // is serialized by the Node event loop within this process.
      for (const [id, accepted] of outlets) {
        for (const [key, entry] of accepted) {
          if (!entry.pending && timestamp - entry.acceptedAt >= UPLOAD_WINDOW_MS) accepted.delete(key);
        }
        if (!accepted.size) outlets.delete(id);
      }

      const key = createHash('sha256').update(validatedSource).digest('hex');
      const accepted = outlets.get(outletId) ?? new Map<string, AcceptedImport>();
      let entry = accepted.get(key);
      if (entry?.pending) return entry.pending as Promise<T>;
      if (entry?.completed) return Promise.resolve(entry.completed as T);

      if (!entry) {
        const active = [...accepted.values()].filter(value => timestamp - value.acceptedAt < UPLOAD_WINDOW_MS);
        if (active.length >= MAX_PRODUCT_EXCEL_UPLOADS) {
          throw new ProductImportQuotaError(Math.min(...active.map(value => value.acceptedAt)) + UPLOAD_WINDOW_MS, timestamp);
        }
        entry = { acceptedAt: timestamp };
        accepted.set(key, entry);
        outlets.set(outletId, accepted);
      }

      const current = entry;
      // Defer execution so concurrent retries see pending before work can start.
      const pending = Promise.resolve().then(importProducts).then(result => {
        if (result.success) current.completed = result;
        return result;
      }).finally(() => {
        // Failures and partial results keep their original acceptance timestamp.
        // The same source may reconcile using the existing writer without a slot.
        delete current.pending;
      });
      current.pending = pending;
      return pending;
    },
  };
}
