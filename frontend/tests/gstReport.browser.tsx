import { createRoot } from 'react-dom/client';
import { GstReportPage } from '../src/pages/GstReportPage.tsx';
import type { OutletSummary } from '../src/pages/OutletSelectionPage.tsx';
import '../src/index.css';
import '../src/App.css';
import '../src/Theme.css';

const checks: string[] = [];
function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
  checks.push(message);
}
const pause = () => new Promise(resolve => setTimeout(resolve, 30));
async function until(check: () => unknown) {
  for (let i = 0; i < 100; i++) { if (check()) return; await pause(); }
  throw new Error('Report did not render');
}
const totals = { taxable: 100000, cgst: 2500, sgst: 2500, igst: 0, gst: 5000, gross: 105000 };
const bills = Array.from({ length: 65 }, (_, index) => ({
  ...totals, documentId: `bill-${index}`, billNo: `GST-${index + 1}`, dayId: '2026-10-19',
  createdDate: new Date(2026, 9, 19, 12).getTime(), taxType: 'exclusive', shiftId: '1',
  rates: [5], finalTotal: totals.gross,
  items: index === 1 ? [] : [
    { ...totals, name: `Product ${index + 1} with a long descriptive name that must wrap completely`, code: '1', quantity: 1, price: 100000, rate: 5 },
    { ...totals, name: `SECOND-PRODUCT-${index + 1}-${'X'.repeat(55)}`, code: '2', quantity: 1, price: 100000, rate: 5 },
  ],
}));
window.fetch = async () => new Response(JSON.stringify({ success: true, data: {
  bills, rates: [], summary: { ...Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, value * bills.length])), totalBills: 65, gstBills: 65 },
} }), { status: 200, headers: { 'Content-Type': 'application/json' } });
let printCalls = 0;
window.print = () => { printCalls++; };
createRoot(document.getElementById('root')!).render(
  <div className="retail-dashboard-shell"><aside className="dashboard-sidebar">Sidebar</aside><div className="dashboard-stage"><header className="retail-header">Navigation</header><main className="dashboard-workspace">
    <GstReportPage outlet={{ id: 'shop', name: 'GST Print Test Shop' } as OutletSummary} token="test" onSessionExpired={() => { throw new Error('Unexpected expiry'); }} />
  </main></div></div>,
);
void (async () => {
  await until(() => document.querySelectorAll('.gst-bill-row').length === 65);
  const rows = [...document.querySelectorAll<HTMLTableRowElement>('.gst-bill-row')];
  assert(document.querySelectorAll('.bill-table-card th').length === 10, 'Report includes ten columns after removing IGST');
  assert([...document.querySelectorAll('.bill-table-card th')].some(cell => cell.textContent === 'Product Name'), 'Product Name column is visible on the report');
  assert(![...document.querySelectorAll('.bill-table-card th')].some(cell => cell.textContent === 'IGST'), 'IGST column is removed from the report');
  assert(rows[0].querySelectorAll('.gst-product-names li').length === 2, 'Each bill lists every product name');
  assert(rows[1].querySelector('.gst-products-cell')?.textContent === '—', 'Bills without item details have a fallback');
  assert(rows.filter(row => getComputedStyle(row).display !== 'none').length === 50, 'Screen pagination shows 50 bills');
  assert(document.querySelector('.bill-table-card tfoot td[colspan="4"]'), 'Totals align with the added product column');
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('.bill-pagination button')];
  buttons[1].click(); await pause();
  assert(getComputedStyle(rows[0]).display === 'none' && getComputedStyle(rows[64]).display !== 'none', 'Second page shows remaining bills');
  document.querySelector<HTMLButtonElement>('.bill-report-actions button:last-child')!.click();
  assert(printCalls === 1, 'Print / PDF invokes browser printing');
  rows[64].click(); await until(() => document.querySelector('.bill-detail-modal'));
  assert(document.querySelector('.bill-detail-modal')!.textContent?.includes('Product 65'), 'Bill details still show product items');
  assert(!document.querySelector('.bill-detail-modal')!.textContent?.includes('IGST'), 'IGST is removed from bill details');
  document.querySelector<HTMLButtonElement>('[aria-label="Close bill details"]')!.click(); await pause();
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, failed: 0, checks });
})().catch(error => {
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, failed: 1, error: String(error), checks });
});
