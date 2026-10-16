import { createRoot } from 'react-dom/client';
import { ProductsPage } from '../src/pages/ProductsPage.tsx';
import type { OutletSummary } from '../src/pages/OutletSelectionPage.tsx';
import '../src/index.css';
const results: string[] = [];
let mode: 'transient' | 'persistent' | 'success' | 'expired' = 'transient';
let productCalls = 0, categoryCalls = 0, expired = 0;
window.fetch = async (url, init) => {
  if (init?.method && init.method !== 'GET') throw new Error('Writes are forbidden in this test');
  const path = String(url);
  if (!path.startsWith('/api/outlets/outlet/')) throw new Error(`Unexpected request blocked: ${path}`);
  if (path.endsWith('/products')) {
    productCalls++;
    if (mode === 'expired') return new Response('', { status: 401 });
    if (mode === 'persistent' || (mode === 'transient' && productCalls === 1)) return new Response('', { status: 500 });
    return Response.json({ success: true, data: [{ documentId: 'existing', fields: { name: 'Existing product', code: 50, price: 20, category: 'cat' } }] });
  }
  if (path.endsWith('/categories')) {
    categoryCalls++;
    if (mode === 'transient' && categoryCalls === 1) return new Response('<html>Bad gateway</html>', { status: 502 });
    return Response.json({ success: true, data: [{ id: 'cat', name: 'Existing category' }] });
  }
  throw new Error(`Unexpected request blocked: ${path}`);
};
const root = createRoot(document.getElementById('root')!);
root.render(<ProductsPage outlet={{ id: 'outlet' } as OutletSummary} token="mock-token" onSessionExpired={() => { expired++; }} />);
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 20));
async function waitFor(check: () => unknown, message: string) { for (let i = 0; i < 140; i++) { if (check()) return; await pause(); } throw new Error(`Timed out: ${message}`); }
function button(label: string) { return [...document.querySelectorAll('button')].find(button => button.textContent === label)!; }
void (async () => {
  await waitFor(() => document.querySelector('tbody')?.textContent?.includes('Existing product'), 'automatic recovery');
  assert(productCalls === 2 && categoryCalls === 2, 'each transient read retried once');
  assert(!document.querySelector('[role="alert"]'), 'successful recovery shows no error');
  results.push('Empty product response and HTML category response recover automatically and display real returned records');

  mode = 'persistent'; button('Refresh').click();
  await waitFor(() => document.querySelector('[role="alert"]')?.textContent?.includes('Unable to load products right now'), 'clear persistent failure');
  assert(productCalls === 4, 'persistent failure stops after one retry');
  assert(!document.body.textContent?.includes('Unexpected end of JSON'), 'JSON parsing details are not exposed');
  assert(button('Retry'), 'manual Retry remains available');
  mode = 'success'; button('Retry').click();
  await waitFor(() => document.querySelector('tbody')?.textContent?.includes('Existing product'), 'manual retry recovers');
  assert(!button('Add New Product').disabled, 'actions reenabled after recovery');
  results.push('Persistent empty response gives a clear error; Retry restores list and controls');

  mode = 'expired'; const before = productCalls; button('Refresh').click();
  await waitFor(() => expired === 1, 'expired session');
  assert(productCalls === before + 1, '401 not retried');
  results.push('Empty 401 response expires the session without a parse error or automatic retry');
  root.unmount(); document.getElementById('test-results')!.textContent = JSON.stringify({ passed: results });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), passed: results }); });
