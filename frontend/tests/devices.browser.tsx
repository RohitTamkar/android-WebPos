import { createRoot } from 'react-dom/client';
import App from '../src/App.tsx';
import '../src/index.css';
localStorage.clear();
localStorage.setItem('pos_user_session', JSON.stringify({ id: 'signed', name: 'Current User', email: 'user@example.com', role: 'Admin', terminal: 'POS', token: 'mock-token' }));
localStorage.setItem('pos_selected_outlet', JSON.stringify({ id: 'shop', name: 'Cached Outlet Name' }));
const checks: string[] = [];
function assert(ok: unknown, message: string) { if (!ok) throw new Error(message); checks.push(message); }
const pause = () => new Promise(resolve => setTimeout(resolve, 25));
async function until(check: () => unknown, message: string) { for (let i = 0; i < 120; i++) { if (check()) return; await pause(); } throw new Error('Timeout: ' + message); }
let status = 200, offline = false, requests = 0;
let release: (() => void) | undefined;
const original = [
  { documentId: 'active', outletName: 'Database Outlet', deviceId: 'DEVICE-A', active: true },
  { documentId: 'inactive', outletName: 'Database Outlet', deviceId: 'DEVICE-B', active: false },
  { documentId: 'unknown', outletName: 'Database Outlet', deviceId: 'DEVICE-C', active: null },
];
let devices = [...original];
window.fetch = async (input, init) => {
  const path = String(input);
  if (path.includes('/dashboard?')) return Response.json({ data: { payments: {} } });
  assert(path === '/api/outlets/shop/devices', 'Devices request uses only the selected outlet');
  assert(!init?.method || init.method === 'GET', 'Device screen only issues GET requests');
  assert((init?.headers as Record<string, string>).Authorization === 'Bearer mock-token' && init?.cache === 'no-store', 'Device list uses the signed session and fresh data');
  requests++;
  await new Promise<void>(resolve => { release = resolve; });
  if (offline) throw new Error('Network unavailable');
  return Response.json(status === 200 ? { success: true, data: { outletName: 'Database Outlet', devices } } : { message: status === 403 ? 'Outlet access denied' : 'Unable to load devices' }, { status });
};
const root = createRoot(document.getElementById('root')!); root.render(<App />);
const nav = () => [...document.querySelectorAll<HTMLButtonElement>('.nav-group-items button')].find(button => button.textContent === 'Device');
const boxes = () => [...document.querySelectorAll<HTMLInputElement>('.device-status input')];
const refresh = () => document.querySelector<HTMLButtonElement>('.devices-heading .devices-refresh')!;
async function refreshList() {
  release = undefined; refresh().click(); await until(() => release, 'refresh request');
  assert(refresh().disabled && !document.querySelector('.devices-table-scroll'), 'Refresh prevents repeated requests and hides outdated rows while loading');
  release!(); await until(() => !!document.querySelector('.crm-login-page') || (refresh() && !refresh().disabled), 'refresh completion');
}
void (async () => {
  await until(() => document.querySelector('.sidebar-nav'), 'navigation');
  [...document.querySelectorAll<HTMLElement>('.nav-group-title')].find(node => node.textContent?.includes('Operations'))!.click();
  await until(nav, 'device menu'); nav()!.click(); await until(() => release, 'device load');
  assert(document.querySelector('h1')?.textContent?.trim() === 'Devices', 'Existing Device menu opens the Devices page');
  assert(document.querySelector('.devices-state[role=status]')?.textContent?.includes('Loading devices'), 'Shows loading feedback while fetching');
  release!(); await until(() => boxes().length === 3, 'device rows');
  assert(JSON.stringify([...document.querySelectorAll('.devices-table-scroll th')].map(node => node.textContent)) === JSON.stringify(['Outlet Name', 'Device ID', 'Status']), 'Displays exactly the three requested columns');
  assert(document.querySelector('.devices-table-scroll')?.textContent?.includes('Database Outlet') && !document.querySelector('.devices-table-scroll')?.textContent?.includes('Cached Outlet Name'), 'Outlet names come from the database response');
  assert(document.querySelector('.devices-table-scroll')?.textContent?.includes('DEVICE-A') && boxes()[0].checked && !boxes()[1].checked, 'Device IDs and checked/unchecked statuses match the API');
  assert(boxes()[2].indeterminate && document.querySelector('.device-status.unavailable')?.textContent === 'Unavailable', 'Missing status is marked unknown rather than falsely Inactive');
  assert(boxes().every(box => box.disabled), 'Status checkboxes remain read-only');
  const before = requests; boxes()[0].click(); await pause();
  assert(boxes()[0].checked && requests === before, 'Clicking a read-only checkbox cannot send a device mutation');
  const table = document.querySelector('.devices-table-scroll')!.getBoundingClientRect();
  assert(table.left >= 0 && table.right <= innerWidth, 'Device table fits the main content area');
  if (innerWidth > 820) {
    const sidebar = document.querySelector('.dashboard-sidebar')!.getBoundingClientRect();
    assert(table.left >= sidebar.right && document.elementFromPoint(sidebar.left + 20, sidebar.top + 20)?.closest('.dashboard-sidebar'), 'Sidebar remains visible and interactive');
  } else assert(!!document.querySelector('.mobile-menu'), 'Mobile sidebar navigation remains available');
  assert(getComputedStyle(document.querySelector('.devices-table-scroll td')!).color === getComputedStyle(document.querySelector('.devices-page')!).color, 'Device and outlet text use the theme text color in light mode');
  const light = getComputedStyle(document.querySelector('.devices-table-scroll')!).backgroundColor;
  document.querySelector<HTMLButtonElement>('.theme-button')!.click(); await pause();
  assert(getComputedStyle(document.querySelector('.devices-table-scroll')!).backgroundColor !== light && requests === before, 'Device table follows dark mode without refetching');
  assert(getComputedStyle(document.querySelector('.devices-table-scroll td')!).color === getComputedStyle(document.querySelector('.devices-page')!).color, 'Device and outlet text remain readable in dark mode');
  document.querySelector<HTMLButtonElement>('.theme-button')!.click(); await pause();
  devices = original.map(row => ({ ...row, active: false })); await refreshList(); await until(() => boxes().length === 3, 'new status');
  assert(boxes().every(box => !box.checked && !box.indeterminate), 'Refresh displays newly fetched database statuses');
  status = 503; await refreshList();
  assert(document.querySelector('.devices-state [role=alert]')?.textContent === 'Unable to load devices' && !boxes().length, 'Database errors show clear feedback and remove stale device information');
  status = 200; release = undefined; document.querySelector<HTMLButtonElement>('.devices-state .devices-refresh')!.click();
  await until(() => release, 'retry request'); release!(); await until(() => boxes().length === 3, 'retry list');
  assert(boxes().every(box => !box.checked), 'Retry retrieves the saved statuses');
  devices = []; await refreshList();
  assert(document.querySelector('.devices-state h2')?.textContent === 'No devices found' && !boxes().length, 'Empty outlets show a clear state without sample devices');
  offline = true; await refreshList();
  assert(document.querySelector('[role=alert]')?.textContent === 'Network unavailable', 'Network failures are displayed'); offline = false;
  status = 403; await refreshList();
  assert(document.querySelector('[role=alert]')?.textContent === 'Outlet access denied' && !boxes().length, 'Unauthorized outlets cannot display a stale list');
  if (location.hash.includes('preview')) {
    status = 200; devices = [...original]; await refreshList();
  } else {
    status = 401; await refreshList();
    await until(() => document.querySelector('.crm-login-page'), 'expired session');
    assert(localStorage.getItem('pos_user_session') === null, 'Expired sessions use existing logout behavior');
    root.unmount();
  }
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, failed: 0, checks });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: 1, error: String(error), checks }); });
