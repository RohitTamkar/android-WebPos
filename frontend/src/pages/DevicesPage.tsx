import { useEffect, useState } from 'react';
import { Monitor, RefreshCw } from 'lucide-react';
import type { OutletSummary } from './OutletSelectionPage.tsx';
import './DevicesPage.css';

interface Device { documentId: string; outletName: string; deviceId: string; active: boolean | null }
interface DeviceList { outletName: string; devices: Device[] }

export function DevicesPage({ outlet, token, onSessionExpired }: {
  outlet: OutletSummary; token: string; onSessionExpired: () => void;
}) {
  const [data, setData] = useState<DeviceList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setData(null);
    void (async () => {
      try {
        const response = await fetch(`/api/outlets/${encodeURIComponent(outlet.id)}/devices`, {
          headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal,
        });
        const result = await response.json() as { data?: DeviceList; message?: string };
        if (controller.signal.aborted) return;
        if (response.status === 401) { onSessionExpired(); return; }
        if (!response.ok || !result.data) throw new Error(result.message || 'Unable to load devices.');
        setData(result.data);
      } catch (failure) { if (!controller.signal.aborted) setError((failure as Error).message); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [outlet.id, token, onSessionExpired, reload]);

  return <section className="devices-page">
    <div className="devices-heading"><div><span>OPERATIONS</span><h1><Monitor size={24} /> Devices</h1><p>{data?.outletName || outlet.name} · Devices registered to this outlet.</p></div>
      <button type="button" className="devices-refresh" disabled={loading} onClick={() => setReload(value => value + 1)}><RefreshCw size={16} />{loading ? 'Loading…' : 'Refresh'}</button></div>
    {loading ? <div className="devices-state" role="status"><RefreshCw size={24} /><p>Loading devices…</p></div> : error ?
      <div className="devices-state"><p role="alert">{error}</p><button type="button" className="devices-refresh" onClick={() => setReload(value => value + 1)}><RefreshCw size={16} /> Retry</button></div> : data && !data.devices.length ?
      <div className="devices-state"><Monitor size={32} /><h2>No devices found</h2><p>No devices are registered to this outlet.</p></div> : data &&
      <div className="devices-table-scroll"><table><thead><tr><th>Outlet Name</th><th>Device ID</th><th>Status</th></tr></thead><tbody>{data.devices.map(device => <tr key={device.documentId}>
        <td>{device.outletName || '—'}</td><td className="device-id">{device.deviceId}</td><td><label className={`device-status ${device.active === true ? 'active' : device.active === false ? 'inactive' : 'unavailable'}`}>
          <input type="checkbox" disabled checked={device.active === true} ref={input => { if (input) input.indeterminate = device.active === null; }} aria-label={`Active status for device ${device.deviceId}`} />
          <span>{device.active === true ? 'Active' : device.active === false ? 'Inactive' : 'Unavailable'}</span>
        </label></td>
      </tr>)}</tbody></table></div>}
  </section>;
}
