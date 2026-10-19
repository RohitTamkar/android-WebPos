import { createRoot } from 'react-dom/client';
import App from '../src/App.tsx';
import '../src/index.css';
localStorage.clear();
localStorage.setItem('pos_user_session', JSON.stringify({ id: 'signed', name: 'Current User', email: 'user@example.com', role: 'Admin', terminal: 'POS', token: 'mock-token' }));
localStorage.setItem('pos_selected_outlet', JSON.stringify({ id: 'shop', name: 'Cached Outlet' }));
const checks: string[] = [];
function assert(ok: unknown, message: string) { if (!ok) throw new Error(message); checks.push(message); }
const pause = () => new Promise(resolve => setTimeout(resolve, 25));
async function until(check: () => unknown, message: string) { for (let i = 0; i < 120; i++) { if (check()) return; await pause(); } throw new Error('Timeout: ' + message); }
let flag: boolean | null = false;
let status = 200, deviceRequests = 0;
let release: (() => void) | undefined;
window.fetch = async (input, init) => {
  const path = String(input);
  if (path.includes('/dashboard?')) return Response.json({ data: { payments: {} } });
  assert(!init?.method || init.method === 'GET', 'Only read requests are made');
  if (path === '/api/outlets/shop/devices') {
    deviceRequests++;
    return Response.json({ data: { outletName: 'Database Outlet', devices: [{ documentId: 'registered-device', deviceId: 'DEVICE-A', outletName: 'Database Outlet', active: true }] } });
  }
  assert(path === '/api/outlets/shop/multicounter', 'Multicounter reads the selected outlet configuration instead of DEVICE');
  assert((init?.headers as Record<string, string>).Authorization === 'Bearer mock-token' && init?.cache === 'no-store', 'Configuration uses session authorization and fresh data');
  await new Promise<void>(resolve => { release = resolve; });
  return Response.json(status === 200 ? { success: true, data: { outletName: 'Database Outlet', multiCounter: flag } } : { message: status === 403 ? 'Outlet access denied' : 'Unable to load configuration' }, { status });
};
const root = createRoot(document.getElementById('root')!); root.render(<App />);
const nav = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('.nav-group-items button')].find(button => button.textContent === name)!;
const refresh = () => document.querySelector<HTMLButtonElement>('.multicounter-page .devices-refresh')!;
const pageText = () => document.querySelector('.multicounter-page')?.textContent ?? '';
async function refreshList() {
  release = undefined; refresh().click(); await until(() => release, 'configuration request');
  assert(refresh().disabled && pageText().includes('Loading multicounter configuration'), 'Refresh shows loading and prevents repeated requests');
  release!(); await until(() => !!document.querySelector('.crm-login-page') || (refresh() && !refresh().disabled), 'request completion');
}
void (async () => {
  await until(() => document.querySelector('.sidebar-nav'), 'navigation');
  [...document.querySelectorAll<HTMLElement>('.nav-group-title')].find(node => node.textContent?.includes('Operations'))!.click();
  await until(() => nav('Multicounter'), 'Multicounter menu'); nav('Multicounter').click(); await until(() => release, 'load');
  assert(pageText().includes('Loading multicounter configuration'), 'Menu fetches outlet configuration with loading feedback');
  release!(); await until(() => pageText().includes('Multicounter is not enabled'), 'disabled state');
  assert(pageText().includes('Database Outlet'), 'Actual outlet name is displayed');
  assert(pageText().includes('Multiple counters are not enabled for this outlet.'), 'False outlet.multiCounter produces the truthful disabled state');
  assert(deviceRequests === 0 && !document.querySelector('.multicounter-page table') && !document.querySelector('.multicounter-page input[type=checkbox]'), 'Device registration IDs and active checkboxes are removed from Multicounter');
  assert(![...document.querySelectorAll('.multicounter-page button')].some(button => /add|create|register|edit|delete/i.test(button.textContent ?? '')), 'No counter creation, editing or registration controls are added');
  const bounds = document.querySelector('.multicounter-page')!.getBoundingClientRect();
  assert(bounds.left >= 0 && bounds.right <= innerWidth, 'Existing page layout fits the available width');
  if (innerWidth > 820) {
    const sidebar = document.querySelector('.dashboard-sidebar')!.getBoundingClientRect();
    assert(bounds.left >= sidebar.right && document.elementFromPoint(sidebar.left + 20, sidebar.top + 20)?.closest('.dashboard-sidebar'), 'Sidebar remains unchanged and interactive');
  }
  flag = true; await refreshList();
  assert(pageText().includes('Counter names and numbers unavailable'), 'Enabled flag is not falsely represented as saved counter names/numbers');
  assert(deviceRequests === 0 && !document.querySelector('.multicounter-page table'), 'Enabled outlets do not fall back to a misleading device list');
  flag = null; await refreshList();
  assert(pageText().includes('Multicounter configuration unavailable'), 'Missing configuration is distinguished from disabled multicounter');
  status = 503; await refreshList();
  assert(document.querySelector('.multicounter-page [role=alert]')?.textContent === 'Unable to load configuration', 'Database failures show a clear error');
  status = 403; await refreshList();
  assert(pageText().includes('Outlet access denied') && !pageText().includes('Multicounter is not enabled'), 'Unauthorized requests cannot expose stale configuration');
  status = 200; flag = false; await refreshList();
  nav('Device').click(); await until(() => document.querySelector('.device-status input'), 'existing Device page');
  assert(document.querySelector('h1')?.textContent?.trim() === 'Devices' && document.querySelector<HTMLInputElement>('.device-status input')!.checked, 'Existing Device page and registration status still work separately');
  release = undefined; nav('Multicounter').click(); await until(() => release, 'return to counters'); release!();
  await until(() => pageText().includes('Multicounter is not enabled'), 'returned configuration');
  assert(deviceRequests === 1 && !document.querySelector('.multicounter-page input'), 'Returning to Multicounter never repeats device status');
  if (!location.hash.includes('preview')) {
    status = 401; await refreshList(); await until(() => document.querySelector('.crm-login-page'), 'expired session');
    assert(localStorage.getItem('pos_user_session') === null, 'Expired sessions use existing logout handling'); root.unmount();
  }
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, failed: 0, checks });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: 1, error: String(error), checks }); });
