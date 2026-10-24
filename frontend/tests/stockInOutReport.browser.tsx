import { createRoot } from 'react-dom/client';
import { StockInOutReportPage } from '../src/pages/StockInOutReportPage.tsx';
import type { OutletSummary } from '../src/pages/OutletSelectionPage.tsx';
import '../src/index.css';
import '../src/App.css';
import '../src/Theme.css';
const results: string[] = [];
const requests: URLSearchParams[] = [];
const movement = (n: number, direction: 'in' | 'out', name: string, qty: number) => ({ documentId: `d${n}`, transactionNo: `stock-${n}`, dayId: '2026-10-24',
  createdDate: Date.UTC(2026, 9, 24, 7, 19 + n), type: direction === 'in' ? 'STOCK-IN' : 'STOCK-OUT', direction, supplier: '', remark: '', source: '', state: '',
  quantity: qty, total: qty * 2, roundOff: 0, finalTotal: qty * 2, items: [{ productId: `p${n}`, name, quantity: qty, price: 2, cost: 0, total: qty * 2, remark: '' }] });
const all = [movement(1, 'out', 'PAPAD ROASTED', 10), movement(2, 'in', 'MASALA PAPAD', 50), movement(3, 'in', 'PAPAD ROASTED', 100)];
window.fetch = async url => {
  const params = new URL(String(url), location.href).searchParams; requests.push(params);
  const movements = all.filter(entry => entry.direction === params.get('direction'));
  const sum = (direction: string) => movements.filter(entry => entry.direction === direction).reduce((total, entry) => total + entry.quantity, 0);
  return Response.json({ success: true, data: { movements, summary: { totalTransactions: movements.length, stockInQuantity: sum('in'), stockOutQuantity: sum('out'),
    netQuantity: sum('in') - sum('out'), totalAmount: movements.reduce((total, entry) => total + entry.finalTotal, 0) } } });
};
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 25));
async function waitFor(check: () => unknown, message: string) { for (let i = 0; i < 150; i++) { if (check()) return; await pause(); } throw new Error(`Timed out: ${message}`); }
const tab = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(node => node.textContent === label)!;
const names = () => [...document.querySelectorAll('tbody tr td:first-child')].map(cell => cell.textContent).join(',');
const headings = () => [...document.querySelectorAll('.bill-table-scroll thead th')].map(cell => cell.textContent).join('|');
const cards = () => [...document.querySelectorAll('.stock-summary-grid small')].map(cell => cell.textContent).join('|');
const root = createRoot(document.getElementById('root')!);
root.render(<StockInOutReportPage outlet={{ id: 'outlet', name: 'OTP' } as OutletSummary} token="mock-token" onSessionExpired={() => {}} />);
void (async () => {
  await waitFor(() => names(), 'stock-in rows');
  assert(tab('STOCK-IN').getAttribute('aria-selected') === 'true' && tab('STOCK-OUT').getAttribute('aria-selected') === 'false', 'Stock-In tab selected by default');
  assert(requests[0]!.get('direction') === 'in', 'default request loads stock-in only');
  assert(names() === 'MASALA PAPAD,PAPAD ROASTED', `stock-in rows ${names()}`);
  assert(headings() === 'Product Name|Type|Quantity|Price|Supplier|Date / Time', `columns ${headings()}`);
  assert(cards() === 'Stock-In Transactions|Stock In Quantity|Total Amount', `cards ${cards()}`);
  assert(document.querySelector('tfoot')!.textContent!.includes('Total Stock-In') && document.querySelector('tfoot')!.textContent!.includes('150'), 'stock-in total');
  assert(!document.body.textContent!.includes('stock-2') && !document.querySelector('select'), 'no transaction numbers or direction dropdown');
  results.push('Stock-In tab is the default and shows only stock-in rows, cards and totals');

  tab('STOCK-OUT').click();
  await waitFor(() => names() === 'PAPAD ROASTED', 'stock-out rows');
  assert(requests.at(-1)!.get('direction') === 'out' && tab('STOCK-OUT').getAttribute('aria-selected') === 'true', 'Stock-Out tab loads stock-out only');
  assert(cards() === 'Stock-Out Transactions|Stock Out Quantity|Total Amount' && document.querySelector('tfoot')!.textContent!.includes('Total Stock-Out'), 'stock-out cards and total');
  const before = requests.length; tab('STOCK-OUT').click(); await pause();
  assert(requests.length === before, 'clicking the active tab does not reload');
  results.push('Stock-Out tab shows only stock-out rows with its own cards and totals');
  root.unmount(); document.getElementById('test-results')!.textContent = JSON.stringify({ passed: results });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), passed: results }); });
