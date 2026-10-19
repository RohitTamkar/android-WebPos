import { useEffect, useState } from 'react';
import { Radio, RefreshCw } from 'lucide-react';
import type { OutletSummary } from './OutletSelectionPage.tsx';
import './DevicesPage.css';

interface DeviceList {
  devices: { documentId: string; outletName: string; deviceId: string; active: boolean | null }[];
}
interface EmployeeList {
  employees: { documentId: string; name: string; userId: string }[];
  userAccounts: { userId: string; name: string }[];
}

function useOutletOverview<T>(outletId: string, token: string, resource: 'devices' | 'employees', reload: number,
  onSessionExpired: () => void) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setData(null); setLoading(true); setError('');
    void (async () => {
      try {
        const response = await fetch(`/api/outlets/${encodeURIComponent(outletId)}/${resource}`, {
          method: 'GET', headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (response.status === 401) { onSessionExpired(); return; }
        const result = await response.json() as { data?: T; message?: string };
        if (controller.signal.aborted) return;
        if (!response.ok || !result.data) throw new Error(result.message || `Unable to load ${resource}.`);
        setData(result.data);
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : `Unable to load ${resource}.`);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [outletId, token, resource, reload, onSessionExpired]);

  return { data, loading, error };
}

export function BroadcastPage({ outlet, token, onSessionExpired }: {
  outlet: OutletSummary; token: string; onSessionExpired: () => void;
}) {
  const [reload, setReload] = useState(0);
  const devices = useOutletOverview<DeviceList>(outlet.id, token, 'devices', reload, onSessionExpired);
  const employees = useOutletOverview<EmployeeList>(outlet.id, token, 'employees', reload, onSessionExpired);
  const loading = devices.loading || employees.loading;
  const refresh = () => setReload(value => value + 1);

  return <section className="devices-page" aria-label="Broadcast overview">
    <div className="devices-heading"><div><span>OPERATIONS</span><h1><Radio size={24} /> Broadcast</h1>
      <p>{outlet.name} · Read-only overview of outlet devices and employees.</p></div>
      <button type="button" className="devices-refresh" disabled={loading} onClick={refresh}><RefreshCw size={16} />{loading ? 'Loading…' : 'Refresh'}</button>
    </div>
    <section className="devices-page" aria-labelledby="broadcast-devices-heading">
      <h2 id="broadcast-devices-heading">Devices</h2>
      {devices.loading ? <div className="devices-state" role="status">Loading devices…</div> : devices.error ?
        <div className="devices-state"><p role="alert">{devices.error}</p><button type="button" className="devices-refresh" disabled={loading} onClick={refresh}>Retry</button></div> : devices.data &&
        (devices.data.devices.length ? <div className="devices-table-scroll"><table><thead><tr><th>Outlet Name</th><th>Device ID</th><th>Activation Status</th></tr></thead>
          <tbody>{devices.data.devices.map(device => <tr key={device.documentId}><td>{device.outletName || outlet.name}</td><td className="device-id">{device.deviceId}</td>
            <td><span className={`device-status ${device.active === true ? 'active' : ''}`}><span>{device.active === true ? 'Active' : device.active === false ? 'Inactive' : 'Unavailable'}</span></span></td></tr>)}</tbody>
        </table></div> : <div className="devices-state"><p>No devices found for this outlet.</p></div>)}
    </section>
    <section className="devices-page" aria-labelledby="broadcast-employees-heading">
      <h2 id="broadcast-employees-heading">Employees</h2>
      {employees.loading ? <div className="devices-state" role="status">Loading employees…</div> : employees.error ?
        <div className="devices-state"><p role="alert">{employees.error}</p><button type="button" className="devices-refresh" disabled={loading} onClick={refresh}>Retry</button></div> : employees.data &&
        (employees.data.employees.length ? <div className="devices-table-scroll"><table><thead><tr><th>Employee Name</th><th>Assigned Account</th></tr></thead>
          <tbody>{employees.data.employees.map(employee => <tr key={employee.documentId}><td>{employee.name || '—'}</td>
            <td>{employee.userId ? employees.data!.userAccounts.find(account => account.userId === employee.userId)?.name || `Account ID: ${employee.userId}` : 'Not assigned'}</td></tr>)}</tbody>
        </table></div> : <div className="devices-state"><p>No employees found for this outlet.</p></div>)}
    </section>
  </section>;
}
