import { useEffect, useMemo, useState } from 'react';

const ROW_BATCH = 100;

// Mounts long lists in batches: rendering thousands of rows at once blocks the
// page. More rows mount as the returned sentinel ref nears the viewport.
// Changing `resetKey` (filters, search, sort) starts again from the first batch.
export function useRowBatches<T>(items: readonly T[], resetKey: string) {
  const [batch, setBatch] = useState({ key: resetKey, limit: ROW_BATCH });
  const limit = batch.key === resetKey ? batch.limit : ROW_BATCH;
  const rows = useMemo(() => items.slice(0, limit), [items, limit]);
  const [sentinel, setSentinel] = useState<HTMLElement | null>(null);
  const hasMore = rows.length < items.length;
  useEffect(() => {
    if (!hasMore || !sentinel) return;
    const grow = () => setBatch({ key: resetKey, limit: limit + ROW_BATCH });
    if (typeof IntersectionObserver === 'undefined') { grow(); return; }
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) grow(); }, { rootMargin: '800px 0px' });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, sentinel, limit, resetKey]);
  return { rows, hasMore, sentinelRef: setSentinel };
}
