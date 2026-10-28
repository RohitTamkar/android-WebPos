import { masterSnapshotRevision, rememberMasterSnapshot } from '../utils/masterSnapshots.ts';
export class ProductListRequestError extends Error {
  status: number;
  retryable: boolean;
  constructor(message: string, status: number, retryable = false) { super(message); this.status = status; this.retryable = retryable; }
}
function waitToRetry(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason ?? new DOMException('Aborted', 'AbortError')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 500);
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}

// Only list GETs are retried. Never retry a write or interpret an invalid response as an empty list.
export async function loadProductList<T>(url: string, token: string, signal: AbortSignal, label: 'products' | 'categories', omitCategoryCounts = false): Promise<T[]> {
  const revision = masterSnapshotRevision();
  const snapshotKey = url + (omitCategoryCounts ? '#metadata' : '');
  const fallback = `Unable to load ${label} right now. Please try again.`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, ...(omitCategoryCounts ? { 'X-Category-Counts': 'omit' } : {}) }, signal });
      if (response.status === 401) throw new ProductListRequestError('Your session has expired. Please sign in again.', 401);
      const text = await response.text();
      let data: unknown;
      try { data = text.trim() ? JSON.parse(text) : null; } catch { data = null; }
      const result = data && typeof data === 'object' ? data as { success?: unknown; message?: unknown; data?: unknown } : null;
      if (response.ok && result?.success === true && Array.isArray(result.data)) {
        if (!signal.aborted) rememberMasterSnapshot(snapshotKey, token, result.data, revision);
        return result.data as T[];
      }
      const retryable = [500, 502, 503, 504].includes(response.status) || (response.ok && !result);
      throw new ProductListRequestError(typeof result?.message === 'string' && result.message.trim() ? result.message : fallback, response.status, retryable);
    } catch (error) {
      if (signal.aborted) throw error;
      const retryable = !(error instanceof ProductListRequestError) || error.retryable;
      if (attempt === 0 && retryable) { await waitToRetry(signal); continue; }
      if (error instanceof ProductListRequestError) throw error;
      throw new ProductListRequestError(fallback, 0);
    }
  }
  throw new ProductListRequestError(fallback, 0);
}

type StreamLine = { type?: unknown; data?: unknown; total?: unknown; message?: unknown };

// Streams a master list (newline-delimited JSON) and reports each batch as it
// arrives. Resolves only after the server confirms the list is complete.
// `fromJson` reads the regular JSON body sent by servers without streaming;
// `snapshot` shapes what is remembered for the page's next visit.
export async function streamList<T>(url: string, token: string, signal: AbortSignal, label: string,
  onProgress: (loaded: T[], total: number | null) => void,
  { fromJson = data => Array.isArray(data) ? data as T[] : null, snapshot = loaded => loaded }:
    { fromJson?: (data: unknown) => T[] | null; snapshot?: (loaded: T[]) => unknown } = {}): Promise<T[]> {
  const revision = masterSnapshotRevision();
  const fallback = `Unable to load ${label} right now. Please try again.`;
  for (let attempt = 0; attempt < 2; attempt++) {
    let received = false;
    try {
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/x-ndjson' }, cache: 'no-store', signal });
      if (response.status === 401) throw new ProductListRequestError('Your session has expired. Please sign in again.', 401);
      if (!response.ok || !response.body || !response.headers.get('Content-Type')?.includes('application/x-ndjson')) {
        // A server without streaming answers with the regular JSON list.
        type ListBody = { success?: unknown; message?: unknown; data?: unknown };
        const text = await response.text();
        let result: ListBody | null;
        try { result = JSON.parse(text) as ListBody | null; } catch { result = null; }
        const listed = response.ok && result?.success === true ? fromJson(result.data) : null;
        if (listed) {
          const loaded = listed;
          onProgress(loaded, loaded.length);
          if (!signal.aborted) rememberMasterSnapshot(url, token, snapshot(loaded), revision);
          return loaded;
        }
        const message = result?.message;
        throw new ProductListRequestError(typeof message === 'string' && message.trim() ? message : fallback, response.status,
          [500, 502, 503, 504].includes(response.status) || response.ok);
      }
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      const loaded: T[] = [];
      let total: number | null = null, buffered = '', complete = false;
      const handle = (text: string) => {
        if (!text.trim()) return;
        const line = JSON.parse(text) as StreamLine;
        if (line.type === 'total' && typeof line.total === 'number') { total = line.total; onProgress(loaded, total); }
        else if (line.type === 'items' && Array.isArray(line.data)) { received = true; loaded.push(...line.data as T[]); onProgress(loaded, total); }
        else if (line.type === 'end') complete = true;
        else if (line.type === 'error') throw new ProductListRequestError(typeof line.message === 'string' ? line.message : fallback, 503, !received);
      };
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffered += value;
        const lines = buffered.split('\n');
        buffered = lines.pop() ?? '';
        lines.forEach(handle);
      }
      handle(buffered);
      if (!complete) throw new ProductListRequestError(fallback, 0, !received);
      if (!signal.aborted) rememberMasterSnapshot(url, token, snapshot(loaded), revision);
      return loaded;
    } catch (error) {
      if (signal.aborted) throw error;
      const retryable = error instanceof ProductListRequestError ? error.retryable : !received;
      if (attempt === 0 && retryable) { await waitToRetry(signal); continue; }
      if (error instanceof ProductListRequestError) throw error;
      throw new ProductListRequestError(fallback, 0);
    }
  }
  throw new ProductListRequestError(fallback, 0);
}

export const streamProductList = <T>(url: string, token: string, signal: AbortSignal, onProgress: (loaded: T[], total: number | null) => void) =>
  streamList<T>(url, token, signal, 'products', onProgress);
