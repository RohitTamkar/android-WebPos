// Short-lived, bounded memory only. Keys include the session, record and reviewed reference.
const previews = new Map<string, { blob: Blob; expires: number }>();
let cachedBytes = 0;
let session = '';
// Product images are often ~300 KB, so keep room for a few screens of thumbnails.
const MAX_BYTES = 48 * 1024 * 1024;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_ENTRIES = 300;
const ENTRY_LIFETIME_MS = 10 * 60_000;
const keyFor = (endpoint: string, reference: string, token: string) => JSON.stringify([token, endpoint, reference]);

function selectSession(token: string) {
  if (session !== token) { previews.clear(); cachedBytes = 0; session = token; }
}

export function rememberImagePreview(endpoint: string, reference: string, token: string, blob: Blob) {
  selectSession(token);
  if (!blob.type.startsWith('image/') || blob.size > MAX_IMAGE_BYTES) return;
  const key = keyFor(endpoint, reference, token);
  const old = previews.get(key);
  if (old) { cachedBytes -= old.blob.size; previews.delete(key); }
  previews.set(key, { blob, expires: Date.now() + ENTRY_LIFETIME_MS }); cachedBytes += blob.size;
  while (cachedBytes > MAX_BYTES || previews.size > MAX_ENTRIES) {
    const first = previews.keys().next().value!;
    cachedBytes -= previews.get(first)!.blob.size; previews.delete(first);
  }
}

export function cachedImagePreview(endpoint: string, reference: string, token: string): Blob | undefined {
  selectSession(token);
  const key = keyFor(endpoint, reference, token), entry = previews.get(key);
  if (!entry) return;
  if (entry.expires <= Date.now()) { cachedBytes -= entry.blob.size; previews.delete(key); return; }
  return entry.blob;
}

let active = 0;
const waiting: (() => void)[] = [];
function drain() { while (active < 4 && waiting.length) waiting.shift()!(); }

// Reserve connection capacity for foreground actions such as PIN verification.
export function loadImagePreview(endpoint: string, reference: string, token: string, signal: AbortSignal): Promise<Blob> {
  const cached = cachedImagePreview(endpoint, reference, token);
  if (signal.aborted) return Promise.reject(new DOMException('Cancelled', 'AbortError'));
  if (cached) return Promise.resolve(cached);
  return new Promise((resolve, reject) => {
    const cancel = () => reject(new DOMException('Cancelled', 'AbortError'));
    signal.addEventListener('abort', cancel, { once: true });
    waiting.push(() => {
      if (signal.aborted) { signal.removeEventListener('abort', cancel); return; }
      active++;
      void (async () => {
        try {
          const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}` },
            cache: 'no-store', priority: 'low', signal });
          if (response.status === 401) throw Object.assign(new Error('Your session has expired.'), { status: 401 });
          if (!response.ok) throw new Error('Image unavailable');
          const blob = await response.blob();
          if (!blob.type.startsWith('image/')) throw new Error('Invalid image response');
          if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
          if (session === token) rememberImagePreview(endpoint, reference, token, blob);
          resolve(blob);
        } catch (error) { reject(error); }
        finally { signal.removeEventListener('abort', cancel); active--; drain(); }
      })();
    });
    drain();
  });
}
