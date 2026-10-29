import { createRoot } from 'react-dom/client';
import App from '../src/App.tsx';
import '../src/index.css';

localStorage.clear();
localStorage.setItem('pos_user_session', JSON.stringify({ id: 'signed', name: 'Cashier', email: 'user@example.com', role: 'Admin', terminal: 'POS', token: 'mock-token' }));
localStorage.setItem('pos_selected_outlet', JSON.stringify({ id: 'shop', name: 'Test Outlet' }));
const checks: string[] = [];
const assert = (ok: unknown, message: string) => { if (!ok) throw new Error(message); checks.push(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 25));
async function until(check: () => unknown, label: string) { for (let i = 0; i < 160; i++) { if (check()) return; await pause(); } throw new Error('Timeout: ' + label); }
window.fetch = async input => {
  const url = new URL(String(input), location.href).pathname;
  if (url.endsWith('/master-sync')) return new Response('', { status: 404 });
  if (url.endsWith('/dashboard')) return Response.json({ data: { id: 'overall', dayId: '2026-10-19', shiftNo: 1, totalSale: 0, payments: {}, shifts: [] } });
  if (url.endsWith('/profile')) return Response.json({ success: true, data: { name: 'Cashier', role: 'Admin', outletName: 'Test Outlet', mobile: '' } });
  return Response.json({ success: true, data: [] });
};
const open = () => [...document.querySelectorAll('.nav-group')].filter(group => group.querySelector('.nav-group-items'))
  .map(group => group.querySelector('.nav-group-title')!.textContent!.trim());
const title = (label: string) => [...document.querySelectorAll<HTMLElement>('.nav-group-title')].find(node => node.textContent?.trim() === label)!;
const item = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('.nav-group-items button')].find(node => node.textContent?.trim() === label);
createRoot(document.getElementById('root')!).render(<App />);
void (async () => {
  await until(() => document.querySelector('.page-hero'), 'dashboard');
  if (innerWidth <= 820) { document.querySelector<HTMLButtonElement>('.mobile-menu')!.click(); await pause(); }
  assert(JSON.stringify(open()) === '["Masters"]', `the dashboard starts with only Masters open (${open()})`);
  title('Operations').click(); await until(() => open().includes('Operations'), 'operations');
  assert(JSON.stringify(open()) === '["Operations"]' && !item('Products') && !!item('Upload Excel'), 'opening Operations closes Masters');
  title('Masters').click(); await until(() => open().includes('Masters'), 'masters');
  assert(JSON.stringify(open()) === '["Masters"]' && !item('Upload Excel') && !!item('Products'), 'opening Masters closes Operations');
  title('Masters').click(); await until(() => !open().length, 'close');
  assert(open().length === 0, 'clicking the open section closes it');
  title('Reports').click(); await until(() => open().includes('Reports'), 'reports');
  title('Home').click(); await until(() => open().includes('Home'), 'home');
  assert(JSON.stringify(open()) === '["Home"]', 'only one section is ever open');
  title('Masters').click(); await until(() => item('Products'), 'products link');
  item('Products')!.click(); await until(() => document.querySelector('.products-page-shell'), 'products page');
  title('Operations').click(); await until(() => item('Upload Excel'), 'upload link');
  item('Upload Excel')!.click(); await until(() => document.querySelector('.upload-excel-page'), 'upload page');
  history.back(); await until(() => document.querySelector('.products-page-shell'), 'back to products');
  assert(JSON.stringify(open()) === '["Masters"]' && item('Products')?.classList.contains('active'), 'Browser Back opens the section of the page it returns to');
  history.forward(); await until(() => document.querySelector('.upload-excel-page'), 'forward to upload');
  assert(JSON.stringify(open()) === '["Operations"]' && item('Upload Excel')?.classList.contains('active'), 'Browser Forward opens that page’s section');
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, checks });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), checks }); });
