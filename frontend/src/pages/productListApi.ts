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
export async function loadProductList<T>(url: string, token: string, signal: AbortSignal, label: 'products' | 'categories'): Promise<T[]> {
  const fallback = `Unable to load ${label} right now. Please try again.`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal });
      if (response.status === 401) throw new ProductListRequestError('Your session has expired. Please sign in again.', 401);
      const text = await response.text();
      let data: unknown;
      try { data = text.trim() ? JSON.parse(text) : null; } catch { data = null; }
      const result = data && typeof data === 'object' ? data as { success?: unknown; message?: unknown; data?: unknown } : null;
      if (response.ok && result?.success === true && Array.isArray(result.data)) return result.data as T[];
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
