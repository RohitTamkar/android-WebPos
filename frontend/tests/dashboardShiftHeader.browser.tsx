import { createRoot } from 'react-dom/client';
import App from '../src/App.tsx';
import '../src/index.css';

localStorage.clear();
localStorage.setItem('pos_user_session', JSON.stringify({ id: 'signed', name: 'Cashier', email: 'user@example.com', role: 'Admin', terminal: 'POS', token: 'mock-token' }));
localStorage.setItem('pos_selected_outlet', JSON.stringify({ id: 'shop', name: 'Test Outlet' }));
const checks: string[] = [];
function assert(ok: unknown, message: string) { if (!ok) throw new Error(message); checks.push(message); }
const pause = () => new Promise(resolve => setTimeout(resolve, 25));
async function until(check: () => unknown, label: string) { for (let i = 0; i < 120; i++) { if (check()) return; await pause(); } throw new Error('Timeout: ' + label); }
let requests = 0;
const shift = (number: number, total: number) => ({ id: `private-shift-id-${number}`, deviceId: `private-device-id-${number}`, shiftNo: number, inActive: number === 1,
  dayId: '2026-10-19', totalSale: total, cashSale: total, digitalSale: 0, creditSale: 0, openingAmt: 0, expCash: 0, billCount: number, payments: { cash: total } });
let shifts = [shift(1, 100), shift(2, 200)];
window.fetch = async (input, init) => {
  assert(String(input).startsWith('/api/outlets/shop/dashboard?'), 'Reads only the selected outlet dashboard');
  assert(!init?.method || init.method === 'GET', 'Dashboard requests remain read-only');
  assert((init?.headers as Record<string, string>).Authorization === 'Bearer mock-token', 'Existing authentication is preserved');
  requests++;
  const dayId = new URL(String(input), location.href).searchParams.get('dayId');
  return Response.json({ data: { ...shift(2, shifts.reduce((sum, item) => sum + item.totalSale, 0)), id: 'overall', dayId, shifts } });
};
const root = createRoot(document.getElementById('root')!);
root.render(<App />);
const tabs = () => [...document.querySelectorAll<HTMLButtonElement>('.page-hero [role=tab]')];
const sale = () => [...document.querySelectorAll('.kpi-card')].find(card => card.querySelector('.kpi-card-topline > span')?.textContent === 'Total Sale')?.querySelector('strong')?.textContent;
void (async () => {
  await until(() => tabs().length === 3 && sale()?.includes('300'), 'header shifts');
  assert(JSON.stringify(tabs().map(tab => tab.textContent)) === JSON.stringify(['All Shifts', 'Shift 1', 'Shift 2']), 'Header contains all shifts using names only');
  assert(!document.querySelector('.shift-table-section') && !document.body.textContent?.includes('Shift-wise Summary'), 'Shift-wise Summary comparison table is removed');
  assert(!document.body.textContent?.includes('private-shift-id') && !document.body.textContent?.includes('private-device-id'), 'Internal shift/device IDs are not displayed on the dashboard');
  const count = requests;
  tabs()[1]!.click(); await pause();
  assert(tabs()[1]!.getAttribute('aria-selected') === 'true' && sale()?.includes('100'), 'Shift 1 selects its existing dashboard figures');
  tabs()[2]!.click(); await pause();
  assert(tabs()[2]!.getAttribute('aria-selected') === 'true' && sale()?.includes('200'), 'Shift 2 selects its existing dashboard figures');
  tabs()[0]!.click(); await pause();
  assert(tabs()[0]!.getAttribute('aria-selected') === 'true' && sale()?.includes('300') && requests === count, 'All Shifts restores overall totals without an extra API request');
  assert(tabs().every(tab => { const box = tab.getBoundingClientRect(); return box.width > 0 && box.left >= 0 && box.right <= innerWidth; }), 'Header shift buttons fit the viewport');
  document.querySelector<HTMLButtonElement>('.theme-button')!.click(); await pause();
  assert(document.documentElement.dataset.theme === 'dark' && tabs()[0]!.getAttribute('aria-selected') === 'true', 'Existing dark theme preserves selected shift');
  shifts = [shift(2, 200)]; window.dispatchEvent(new Event('focus'));
  await until(() => tabs().length === 2, 'single shift refresh');
  assert(tabs()[0]!.textContent === 'All Shifts' && tabs()[1]!.textContent === 'Shift 2', 'A single available shift is still named in the header');
  root.unmount(); document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, failed: 0, checks });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: 1, error: String(error), checks }); });
