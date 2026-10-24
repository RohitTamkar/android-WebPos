import { useEffect, useState } from 'react';
import { Users, RefreshCw } from 'lucide-react';
import type { OutletSummary } from './OutletSelectionPage.tsx';
import './DevicesPage.css';

interface MulticounterConfiguration { outletName: string; multiCounter: boolean | null }

export function MulticounterPage({ outlet, token, onSessionExpired }: {
  outlet: OutletSummary; token: string; onSessionExpired: () => void;
}) {
  const [data, setData] = useState<MulticounterConfiguration | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setData(null);
    void (async () => {
      try {
        const response = await fetch(`/api/outlets/${encodeURIComponent(outlet.id)}/multicounter`, {
          headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal,
        });
        const result = await response.json() as { data?: MulticounterConfiguration; message?: string };
        if (controller.signal.aborted) return;
        if (response.status === 401) { onSessionExpired(); return; }
        if (!response.ok || !result.data) throw new Error(result.message || 'Unable to load multicounter configuration.');
        setData(result.data);
      } catch (failure) { if (!controller.signal.aborted) setError((failure as Error).message); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [outlet.id, token, onSessionExpired, reload]);

  return <section className="devices-page multicounter-page">
    <div className="devices-heading"><div><span>OPERATIONS</span><h1><Users size={24} /> Multicounter</h1><p>{data?.outletName || outlet.name} · Configured billing counters for this outlet.</p></div>
      <button type="button" className="devices-refresh" disabled={loading} onClick={() => setReload(value => value + 1)}><RefreshCw size={16} />{loading ? 'Loading…' : 'Refresh'}</button></div>
    {loading ? <div className="devices-state" role="status"><RefreshCw size={24} /><p>Loading multicounter configuration…</p></div> : error ?
      <div className="devices-state"><p role="alert">{error}</p><button type="button" className="devices-refresh" onClick={() => setReload(value => value + 1)}><RefreshCw size={16} /> Retry</button></div> : data &&
      <div className="devices-state"><Users size={32} />
        {data.multiCounter === false ? <><h2>Multicounter is not enabled</h2><p>Multiple counters are not enabled for this outlet.</p></> :
          data.multiCounter === true ? <><h2>Counter names and numbers unavailable</h2><p>Multicounter is enabled, but the configured counter list is not available from the connected outlet data.</p></> :
          <><h2>Multicounter configuration unavailable</h2><p>No multicounter setting is available for this outlet.</p></>}
      </div>}
  </section>;
}
