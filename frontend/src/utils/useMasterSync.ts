import { useEffect, useRef } from 'react';

type Kind = 'products' | 'categories' | 'customers';
const hidden = () => document.visibilityState === 'hidden';

// One read-only change feed for the visible list. Coalesce notifications and
// keep the current rows and editor in place while fetching fresh data.
export function useMasterSync(outletId: string, token: string, kind: Kind, enabled: boolean,
  refresh: (signal: AbortSignal) => Promise<void>) {
  const callback = useRef(refresh);
  callback.current = refresh;
  // Collection versions this page has loaded, kept while a form pauses the feed.
  const loaded = useRef({ key: '', versions: new Map<string, string>() });
  useEffect(() => {
    if (!enabled) return;
    const key = JSON.stringify([outletId, token, kind]);
    if (loaded.current.key !== key) loaded.current = { key, versions: new Map() };
    const versions = loaded.current.versions, seen = new Map<string, string>();
    let stopped = false, pending = false, refreshing = false, delay = 1000;
    let connection: AbortController | undefined;
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const updates = new AbortController();
    let refreshDelay = 1000;
    const update = async () => {
      if (stopped || hidden()) return;
      if (refreshing) { pending = true; return; }
      refreshing = true; pending = false;
      const reconciled = new Map(seen);
      try {
        await callback.current(AbortSignal.any([updates.signal, AbortSignal.timeout(30_000)]));
        for (const [collection, version] of reconciled) versions.set(collection, version);
        refreshDelay = 1000;
      }
      catch { pending = true; refreshDelay = Math.min(refreshDelay * 2, 15_000); }
      finally {
        refreshing = false;
        if (pending && !stopped && !debounce) debounce = setTimeout(() => { debounce = undefined; void update(); }, refreshDelay);
      }
    };
    const changed = () => {
      if (!debounce) debounce = setTimeout(() => { debounce = undefined; void update(); }, 300);
    };
    const connect = async () => {
      if (stopped || hidden()) return;
      connection?.abort();
      const controller = new AbortController(); connection = controller;
      let watchdog = setTimeout(() => controller.abort(), 30_000);
      try {
        const response = await fetch(`/api/outlets/${encodeURIComponent(outletId)}/master-sync?kind=${kind}`, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/x-ndjson' }, cache: 'no-store', signal: controller.signal,
        });
        if ([401, 403, 404, 428, 429].includes(response.status)) return;
        if (!response.ok || !response.body || !response.headers.get('Content-Type')?.includes('application/x-ndjson')) throw new Error('Unavailable');
        delay = 1000;
        const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = '';
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            clearTimeout(watchdog); watchdog = setTimeout(() => controller.abort(), 30_000);
            buffer += value;
            const lines = buffer.split('\n'); buffer = lines.pop() ?? '';
            for (const line of lines) {
              if (!line.trim()) continue;
              const message = JSON.parse(line) as { type?: unknown; collection?: unknown; version?: unknown };
              if (message.type !== 'changed') continue;
              // Unversioned notices always refresh. A reconnect reporting the
              // version already loaded needs no new list download.
              if (typeof message.collection === 'string' && typeof message.version === 'string') {
                seen.set(message.collection, message.version);
                if (versions.get(message.collection) === message.version) continue;
              }
              changed();
            }
          }
        } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
      } catch { /* Retry a dropped connection with bounded backoff. */ }
      finally { clearTimeout(watchdog); controller.abort(); }
      if (!stopped && connection === controller && !hidden()) {
        reconnect = setTimeout(() => { void connect(); }, delay);
        delay = Math.min(delay * 2, 15_000);
      }
    };
    const resume = () => {
      clearTimeout(reconnect);
      connection?.abort();
      if (!hidden()) { changed(); void connect(); }
    };
    void connect();
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    return () => {
      stopped = true; connection?.abort(); updates.abort(); clearTimeout(reconnect); clearTimeout(debounce);
      document.removeEventListener('visibilitychange', resume); window.removeEventListener('online', resume);
    };
  }, [outletId, token, kind, enabled]);
}
