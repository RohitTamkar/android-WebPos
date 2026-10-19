import { createRoot } from 'react-dom/client';
import App from '../src/App.tsx';
import '../src/index.css';

localStorage.clear();
localStorage.setItem('pos_user_session', JSON.stringify({ id: 'user', name: 'Test User', email: 'test@example.com', role: 'Admin', terminal: 'POS', token: 'mock-token' }));
localStorage.setItem('pos_selected_outlet', JSON.stringify({ id: 'outlet', name: 'Test Shop', branch: 'Pune' }));
const checks: string[] = [];
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); checks.push(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 25));
async function until(check: () => unknown, message: string) {
  for (let i = 0; i < 120; i++) { if (check()) return; await pause(); }
  throw new Error(`Timeout: ${message}`);
}
let requests = 0;
window.fetch = async url => {
  requests++;
  const path = String(url);
  if (path.includes('/dashboard?')) return Response.json({ data: { totalSale: 500, cashSale: 400, digitalSale: 100, openingAmt: 50, expCash: 0, payments: { cash: 400, googlepay: 100 }, billCount: 5, shiftNo: 1 } });
  if (path.endsWith('/categories')) return Response.json({ data: [] });
  if (path.includes('/reports/products?')) return Response.json({ data: { products: [{ productId: 'product', code: '1', name: 'Test product', category: 'Food', billCount: 5, quantity: 5, averageRate: 100, amount: 500, share: 100 }], summary: { totalProducts: 1, totalBills: 5, totalQuantity: 5, totalAmount: 500 } } });
  throw new Error(`Unexpected API blocked: ${path}`);
};
let root = createRoot(document.getElementById('root')!);
root.render(<App />);
const toggle = () => document.querySelector<HTMLButtonElement>('.theme-button')!;
const theme = () => document.documentElement.dataset.theme;
const date = () => document.querySelector('.dashboard-date-picker')?.textContent?.split(/\d{2}:\d{2}:\d{2}/)[0];
const kpis = () => [...document.querySelectorAll('.kpi-card > strong')].map(element => element.textContent).join('|');
void (async () => {
  await until(() => toggle() && kpis().includes('500'), 'dashboard');
  assert(!document.querySelector('.notification-button') && !document.querySelector('[aria-label=Notifications]'), 'notification icon and badge are removed');
  assert(theme() === 'light' && toggle().getAttribute('aria-label') === 'Switch to dark mode', 'starts in light mode with a descriptive moon button');
  assert(toggle().getClientRects().length > 0, 'theme control is visible at this viewport');
  const lightCard = getComputedStyle(document.querySelector('.payment-section')!).backgroundColor;
  const originalDate = date(); const originalKpis = kpis();
  const originalOutlet = localStorage.getItem('pos_selected_outlet');
  const bounds = document.querySelector('.payment-section')!.getBoundingClientRect();
  const originalRequests = requests;
  toggle().click(); await until(() => theme() === 'dark', 'dark mode');
  assert(getComputedStyle(document.querySelector('.payment-section')!).backgroundColor !== lightCard, 'dashboard surfaces change to dark colors');
  assert(localStorage.getItem('pos_theme') === 'dark' && toggle().getAttribute('aria-pressed') === 'true', 'dark preference is stored and exposed accessibly');
  assert(date() === originalDate && kpis() === originalKpis && localStorage.getItem('pos_selected_outlet') === originalOutlet, 'theme changes preserve dates, totals and the selected outlet');
  assert(requests === originalRequests, 'theme toggle does not reload data or issue API requests');
  const darkBounds = document.querySelector('.payment-section')!.getBoundingClientRect();
  assert(bounds.width === darkBounds.width && bounds.height === darkBounds.height && bounds.top === darkBounds.top, 'theme switch preserves dashboard layout');
  document.querySelector<HTMLButtonElement>('.report-date-trigger')!.click(); await until(() => document.querySelector('.report-date-calendar'), 'calendar');
  assert(getComputedStyle(document.querySelector('.report-date-calendar')!).backgroundColor === 'rgb(25, 35, 49)', 'calendar portal follows dark mode');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await pause();
  toggle().click(); await until(() => theme() === 'light', 'light mode');
  assert(getComputedStyle(document.querySelector('.payment-section')!).backgroundColor === lightCard && localStorage.getItem('pos_theme') === 'light', 'second click restores the original light colors');
  toggle().click(); await until(() => theme() === 'dark', 'dark preference');
  root.unmount(); root = createRoot(document.getElementById('root')!); root.render(<App />);
  await until(() => toggle() && kpis().includes('500'), 'remount');
  assert(theme() === 'dark' && toggle().getAttribute('aria-pressed') === 'true', 'saved dark preference survives remount');
  if (innerWidth > 1100) {
    const reports = [...document.querySelectorAll<HTMLButtonElement>('.nav-group-title')].find(button => button.textContent?.includes('Reports'))!;
    reports.click(); await pause();
    [...document.querySelectorAll<HTMLButtonElement>('.nav-group-items button')].find(button => button.textContent === 'Product Wise')!.click();
    await until(() => document.querySelector('.product-report-page tbody tr'), 'product report');
    assert(getComputedStyle(document.querySelector('.bill-table-card')!).backgroundColor === 'rgb(25, 35, 49)', 'report table uses dark surfaces');
    assert(getComputedStyle(document.querySelector('.bill-table-card td strong')!).color === 'rgb(229, 237, 247)', 'report text remains readable');
  }
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, checks });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), checks }); });
