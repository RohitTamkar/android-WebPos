import { createRoot } from 'react-dom/client';
import App from '../src/App.tsx';
import { BroadcastPage } from '../src/pages/BroadcastPage.tsx';
import type { OutletSummary } from '../src/pages/OutletSelectionPage.tsx';
import '../src/index.css';

localStorage.clear();
localStorage.setItem('pos_user_session', JSON.stringify({ id: 'signed', name: 'Test User', email: 'user@example.com', role: 'Admin', terminal: 'POS', token: 'mock-token' }));
localStorage.setItem('pos_selected_outlet', JSON.stringify({ id: 'shop', name: 'Selected Outlet' }));
const checks: string[] = [];
function assert(ok: unknown, message: string) { if (!ok) throw new Error(message); checks.push(message); }
const pause = () => new Promise(resolve => setTimeout(resolve, 25));
async function until(check: () => unknown, label: string) {
  for (let i = 0; i < 120; i++) { if (check()) return; await pause(); }
  throw new Error(`Timeout: ${label}`);
}
let deviceStatus = 200, employeeStatus = 200, empty = false, offline = false;
const pending: { outlet: string; resource: string; release: () => void }[] = [];
window.fetch = async (input, init) => {
  const path = String(input);
  if (path.includes('/dashboard?')) return Response.json({ data: { payments: {} } });
  const match = path.match(/^\/api\/outlets\/(shop|next)\/(devices|employees)$/);
  assert(match, 'Broadcast uses only existing outlet device/employee APIs');
  assert(init?.method === 'GET', 'Every Broadcast request is explicitly read-only');
  assert((init?.headers as Record<string, string>).Authorization === 'Bearer mock-token', 'Requests use existing session authentication');
  const [, outlet, resource] = match!;
  const status = resource === 'devices' ? deviceStatus : employeeStatus;
  const data = resource === 'devices' ? { devices: empty ? [] : [
    { documentId: 'a', outletName: outlet, deviceId: `${outlet}-ACTIVE`, active: true },
    { documentId: 'b', outletName: outlet, deviceId: `${outlet}-INACTIVE`, active: false },
    { documentId: 'c', outletName: outlet, deviceId: `${outlet}-UNKNOWN`, active: null },
  ] } : { employees: empty ? [] : [
    { documentId: 'a', name: `${outlet} Employee`, userId: 'account' },
    { documentId: 'b', name: 'Unassigned Employee', userId: '' },
    { documentId: 'c', name: 'Legacy Employee', userId: 'missing' },
  ], userAccounts: [{ userId: 'account', name: 'Assigned User' }] };
  const fail = offline;
  // Resolve even after cancellation to verify late responses cannot overwrite the current outlet.
  await new Promise<void>(resolve => pending.push({ outlet, resource, release: resolve }));
  if (fail) throw new Error('Network unavailable');
  return Response.json(status === 200 ? { data } : { message: `${resource} unavailable` }, { status });
};
const root = createRoot(document.getElementById('root')!);
root.render(<App />);
const page = () => document.querySelector('[aria-label="Broadcast overview"]')!;
const text = () => page()?.textContent || '';
const refresh = () => page().querySelector<HTMLButtonElement>('.devices-heading button')!;
const releaseAll = () => pending.splice(0).forEach(request => request.release());
async function reload() {
  refresh().click(); await until(() => pending.length === 2, 'refresh requests');
  assert(page().querySelectorAll('[role=status]').length === 2 && !page().querySelector('tbody'), 'Refresh hides old rows and shows both loading states');
  releaseAll(); await until(() => !refresh().disabled, 'refresh completion');
}
void (async () => {
  await until(() => document.querySelector('.sidebar-nav'), 'sidebar');
  [...document.querySelectorAll<HTMLElement>('.nav-group-title')].find(node => node.textContent?.includes('Operations'))!.click();
  const nav = () => [...document.querySelectorAll<HTMLButtonElement>('.nav-group-items button')].find(button => button.textContent === 'Broadcast');
  await until(nav, 'Broadcast navigation'); nav()!.click();
  await until(() => pending.length === 2, 'parallel overview requests');
  assert(page().querySelector('h1')?.textContent?.trim() === 'Broadcast', 'Broadcast navigation opens its dedicated page');
  assert(page().querySelectorAll('[role=status]').length === 2, 'Devices and employees show loading states');
  assert(pending.every(request => request.outlet === 'shop'), 'Both requests are scoped to the selected outlet');
  releaseAll(); await until(() => text().includes('shop Employee'), 'overview rows');
  assert(text().includes('shop-ACTIVE') && text().includes('Inactive') && text().includes('Unavailable'), 'Devices display IDs and active, inactive, and unknown activation states');
  assert(text().includes('Assigned User') && text().includes('Not assigned') && text().includes('Account ID: missing'), 'Employee assignments show available names and honest missing-account fallbacks');
  assert(!page().querySelector('input,textarea,select,form') && [...page().querySelectorAll('button')].every(button => button.textContent?.trim() === 'Refresh'), 'Overview has no composition, recipient selection, or mutation controls');
  assert(document.querySelector('.dashboard-sidebar') && document.querySelector('.retail-header'), 'Existing sidebar and header remain present');
  assert([...page().querySelectorAll('.devices-table-scroll')].every(table => {
    const bounds = table.getBoundingClientRect(); return bounds.left >= 0 && bounds.right <= innerWidth;
  }), 'Overview tables fit the available content area');
  document.querySelector<HTMLButtonElement>('.theme-button')!.click(); await pause();
  assert(document.documentElement.dataset.theme === 'dark', 'Existing dark theme remains available');
  deviceStatus = 503; await reload();
  assert(text().includes('devices unavailable') && text().includes('shop Employee'), 'Device errors preserve successfully loaded employee information');
  deviceStatus = 200; employeeStatus = 403; await reload();
  assert(text().includes('employees unavailable') && text().includes('shop-ACTIVE'), 'Employee access errors preserve independently authorized device information');
  employeeStatus = 200; empty = true; await reload();
  assert(text().includes('No devices found for this outlet.') && text().includes('No employees found for this outlet.'), 'Both sections handle empty outlets without sample rows');
  empty = false; offline = true; await reload();
  assert(page().querySelectorAll('[role=alert]').length === 2 && text().includes('Network unavailable'), 'Network failures display errors for both sections');
  offline = false;
  page().querySelector<HTMLButtonElement>('.devices-state button')!.click();
  await until(() => pending.length === 2, 'retry'); releaseAll();
  await until(() => text().includes('shop Employee'), 'retry results');
  assert(!page().querySelector('[role=alert]'), 'Retry recovers failed requests');
  [...document.querySelectorAll<HTMLButtonElement>('.nav-group-items button')].find(button => button.textContent === 'Dashboard')!.click();
  await until(() => document.querySelector('.dashboard-insights'), 'dashboard quick actions');
  const shortcut = [...document.querySelectorAll<HTMLButtonElement>('.insight-card button')].find(button => button.querySelector('strong')?.textContent === 'Broadcast')!;
  assert(shortcut.textContent?.includes('View devices and employees') && !shortcut.textContent?.includes('Send'), 'Broadcast shortcut describes the read-only overview');
  shortcut.click(); await until(() => pending.length === 2, 'shortcut requests'); releaseAll();
  await until(() => text().includes('shop Employee'), 'shortcut overview');
  assert(page().querySelector('h1')?.textContent?.trim() === 'Broadcast', 'Dashboard shortcut also opens the dedicated Broadcast page');
  refresh().click(); await until(() => pending.length === 2, 'old outlet pending');
  const old = pending.splice(0);
  root.render(<BroadcastPage key="next" outlet={{ id: 'next', name: 'Next Outlet' } as OutletSummary} token="mock-token" onSessionExpired={() => { throw new Error('Unexpected expiry'); }} />);
  await until(() => pending.length === 2, 'new outlet requests');
  assert(!text().includes('shop-ACTIVE') && pending.every(request => request.outlet === 'next'), 'Outlet changes clear previous data and request only the new outlet');
  releaseAll(); await until(() => text().includes('next Employee'), 'new outlet rows');
  old.forEach(request => request.release()); await pause();
  assert(text().includes('next-ACTIVE') && !text().includes('shop-ACTIVE'), 'Late responses from the previous outlet cannot overwrite current data');
  deviceStatus = 401; let expired = false;
  root.render(<BroadcastPage key="expired" outlet={{ id: 'next', name: 'Next Outlet' } as OutletSummary} token="mock-token" onSessionExpired={() => { expired = true; }} />);
  await until(() => pending.length === 2, 'expiry requests'); releaseAll(); await until(() => expired, 'session callback');
  assert(expired, 'Unauthorized sessions use the existing session-expired callback');
  root.unmount();
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, failed: 0, checks });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: 1, error: String(error), checks }); });
