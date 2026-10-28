import { createRoot } from 'react-dom/client';
import App from '../src/App.tsx';
import '../src/index.css';
import { clearMasterSnapshots } from '../src/utils/masterSnapshots.ts';
const checks: string[] = [];
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); checks.push(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 20));
async function until(check: () => unknown) { for (let i = 0; i < 200; i++) { if (check()) return; await pause(); } throw new Error('Timed out'); }
clearMasterSnapshots(); localStorage.clear(); history.replaceState(null, '');
localStorage.setItem('pos_user_session', JSON.stringify({ id: 'user', email: 'user@example.com', name: 'User', role: 'Admin', terminal: 'POS', token: 'mock' }));
localStorage.setItem('pos_selected_outlet', JSON.stringify({ id: 'outlet', name: 'Outlet', active: true }));
let dashboardRequests = 0;
const revisions: Record<string, number> = { products: 1, categories: 1, customers: 1, employees: 1 };
const pending = new Map<string, (response: Response) => void>();
let hold = '';
function payload(kind: string) {
  const suffix = revisions[kind];
  if (kind === 'products') return [{ documentId: 'p', fields: { name: `Product ${suffix}`, code: 1, price: 10, category: 'c', type: 0, currentStock: 0 } }];
  if (kind === 'categories') return [{ id: 'c', name: `Category ${suffix}`, categoryNo: 1, active: true, productCount: 1, regionalName: '', dayType: '', createdAt: '' }];
  if (kind === 'customers') return { customers: [{ documentId: 'customer', name: `Customer ${suffix}`, contact: '123', creditLimit: 0, dayLimit: 0, balance: 0, allowedCredit: false }] };
  return { employees: [{ documentId: 'employee', name: `Employee ${suffix}`, searchCode: 1, mobile: '123', shortName: 'E', balanceAmt: '0', dateOfJoining: '', userId: '' }], nextSearchCode: 2, userAccounts: [] };
}
window.fetch = async (input, init) => {
  const path = String(input);
  assert(!init?.method || init.method === 'GET', 'loading uses read-only requests');
  if (path.includes('/dashboard?')) { dashboardRequests++; return Response.json({ success: true, data: { dayId: new URL(path, location.href).searchParams.get('dayId'), shifts: [], payments: {} } }); }
  if (path.endsWith('/profile')) return Response.json({ success: true, data: { name: 'User', role: 'Admin' } });
  const kind = path.split('/').at(-1)!;
  if (!(kind in revisions)) throw new Error(`Unexpected ${path}`);
  if (kind === 'categories' && new Headers(init?.headers).get('X-Category-Counts') === 'omit') assert(true, 'Products requests category metadata without a product-count scan');
  if (kind === hold) return new Promise<Response>(resolve => pending.set(kind, resolve));
  return Response.json({ success: true, data: payload(kind) });
};
const root = createRoot(document.getElementById('root')!); root.render(<App />);
const navigate = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('.nav-group-items button')].find(button => button.textContent === label)!.click();
const tableHas = (text: string) => document.querySelector('.dashboard-workspace tbody')?.textContent?.includes(text);
void (async () => {
  await until(() => document.querySelector('.page-hero'));
  const masters = [...document.querySelectorAll('.nav-group')].find(group => group.querySelector('.nav-group-title')?.textContent?.includes('Masters'))!;
  const labels = [...masters.querySelectorAll('button')].map(button => button.textContent!);
  assert(JSON.stringify(labels) === JSON.stringify([...labels].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }))), 'Masters entries are alphabetically ordered');
  for (const [label, kind, row] of [['Products', 'products', 'Product'], ['Category', 'categories', 'Category'], ['Customer', 'customers', 'Customer'], ['Employees/Salesman', 'employees', 'Employee']]) {
    navigate(label!); await until(() => tableHas(`${row} 1`));
    const count = dashboardRequests; window.dispatchEvent(new Event('focus')); await pause();
    assert(dashboardRequests === count, `${label} does not trigger off-screen dashboard polling`);
    navigate('Dashboard'); await until(() => document.querySelector('.page-hero'));
    hold = kind!; navigate(label!); await until(() => pending.has(kind!));
    assert(tableHas(`${row} 1`), `${label} immediately shows its recent snapshot while a fresh authorized GET is pending`);
    revisions[kind!] = 2; pending.get(kind!)!(Response.json({ success: true, data: payload(kind!) })); hold = ''; pending.delete(kind!);
    await until(() => tableHas(`${row} 2`));
    assert(true, `${label} replaces cached rows with the fresh server result`);
  }
  root.unmount(); document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, checks });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), checks }); });
