import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { StockAdjustmentPage } from '../src/pages/StockAdjustmentPage.tsx';
import { StockReportPage } from '../src/pages/StockReportPage.tsx';
import type { OutletSummary } from '../src/pages/OutletSelectionPage.tsx';
import '../src/index.css';

const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const outlet = { id: 'outlet', name: 'Test Outlet' } as OutletSummary;
const expired = () => { throw new Error('Unexpected expiration'); };
let stock = 0, reportReads = 0;
const committed = new Set<string>();
window.fetch = async (url, init) => {
  const path = String(url);
  assert(new Headers(init?.headers).get('Authorization') === 'Bearer token', 'Authenticated requests');
  assert(path.startsWith('/api/outlets/outlet/'), 'Selected outlet');
  if (path.endsWith('/products')) return Response.json({ success: true, data: [{ documentId: 'tea', fields: { name: 'Tea', code: 1, currentStock: stock, stockable: true } }] });
  if (path.includes('/reports/stock-movements?')) return Response.json({ data: { movements: [] } });
  if (path.endsWith('/stock-adjustments')) {
    const body = JSON.parse(String(init?.body));
    if (!committed.has(body.requestId)) {
      assert(body.items[0].expectedStock === stock, 'Saved stock is the expected starting balance');
      stock += body.direction === 'in' ? body.items[0].quantity : -body.items[0].quantity;
      committed.add(body.requestId);
    }
    return Response.json({ success: true, data: { documentId: body.requestId } });
  }
  if (path.endsWith('/reports/stock')) {
    reportReads++;
    assert(init?.cache === 'no-store', 'Report always requests fresh balances');
    return Response.json({ success: true, data: { categories: [], products: [{ productId: 'tea', code: '1', name: 'Tea', categoryId: '', category: 'Uncategorized',
      tracked: true, currentStock: stock, reorderLevel: 0, price: 2, costPrice: 1, stockValue: stock * 2, status: stock > 0 ? 'In stock' : 'Out of stock' }] } });
  }
  throw new Error(`Unexpected request: ${path}`);
};
function App() {
  const [report, setReport] = useState(false);
  return <><button onClick={() => setReport(false)}>Adjust inventory</button><button onClick={() => setReport(true)}>View stock report</button>
    {report ? <StockReportPage outlet={outlet} token="token" onSessionExpired={expired} /> : <StockAdjustmentPage outlet={outlet} token="token" onSessionExpired={expired} />}</>;
}
createRoot(document.getElementById('root')!).render(<App />);
const pause = () => new Promise(resolve => setTimeout(resolve, 20));
async function until(check: () => unknown, label: string) {
  for (let i = 0; i < 150; i++) { if (check()) return; await pause(); }
  throw new Error(`Timeout: ${label}`);
}
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === text)!;
async function input(label: string, value: string) {
  const el = document.querySelector<HTMLInputElement | HTMLSelectElement>(`[aria-label="${label}"]`)!;
  Object.getOwnPropertyDescriptor(el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); await pause();
}
async function adjust(direction: 'In' | 'Out', quantity: string) {
  await until(() => document.querySelector(`[aria-label="Go ahead with Stock ${direction}"]`), 'stock choices');
  document.querySelector<HTMLButtonElement>(`[aria-label="Go ahead with Stock ${direction}"]`)!.click();
  await until(() => document.querySelector('option[value="tea"]'), 'products loaded');
  await input('Select product', 'tea');
  if (direction === 'Out') await input('Select remark', 'Issued');
  document.querySelector<HTMLButtonElement>('[aria-label="Add selected product"]')!.click();
  await until(() => document.querySelector('[aria-label="Quantity for Tea"]'), 'quantity input');
  await input('Quantity for Tea', quantity);
  button(direction === 'In' ? 'Add Stock' : 'Remove Stock').click();
  await until(() => document.querySelector('dialog[open]'), 'review');
  button('Confirm stock changes').click();
  await until(() => button('OK'), 'saved'); button('OK').click();
  await until(() => !document.querySelector('dialog[open]'), 'dismissed success');
}
void (async () => {
  await adjust('In', '50'); assert(stock === 50, 'Stock-in adds 50');
  button('Back').click(); await adjust('Out', '5'); assert(stock === 45, 'Stock-out leaves 45');
  button('View stock report').click();
  await until(() => document.querySelector('.stock-count')?.textContent === '45', 'report balance 45');
  assert(document.querySelector('tfoot')?.textContent?.includes('45'), 'Table total is 45');
  const summary = [...document.querySelectorAll('.bill-summary-grid article')].find(article => article.textContent?.includes('Total Stock Qty'));
  assert(summary?.querySelector('strong')?.textContent === '45', 'Summary is 45');
  assert(document.querySelector('tbody')?.textContent?.includes('₹90.00'), 'Stock value uses 45 units');
  stock = 40; button('Refresh').click();
  await until(() => document.querySelector('.stock-count')?.textContent === '40', 'fresh balance after refresh');
  assert(reportReads === 2 && committed.size === 2, 'Refreshing does not replay stock changes');
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed: ['Stock In 50 → Stock Out 5 → report row, total and summary 45; valuation 90; refresh fetches latest balance without replaying changes'] });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error) }); });
