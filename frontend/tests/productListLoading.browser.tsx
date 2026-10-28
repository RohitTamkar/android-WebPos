import { createRoot } from 'react-dom/client';
import { ProductsPage } from '../src/pages/ProductsPage.tsx';
import { clearMasterSnapshots } from '../src/utils/masterSnapshots.ts';
import type { OutletSummary } from '../src/pages/OutletSelectionPage.tsx';
import '../src/index.css';
const results: string[] = [];
let mode: 'transient' | 'persistent' | 'success' | 'large' | 'stream' | 'broken' | 'expired' = 'transient';
let releaseStream: () => void = () => {};
let productCalls = 0, categoryCalls = 0, expired = 0;
window.fetch = async (url, init) => {
  if (init?.method && init.method !== 'GET') throw new Error('Writes are forbidden in this test');
  const path = String(url);
  if (!path.startsWith('/api/outlets/outlet/')) throw new Error(`Unexpected request blocked: ${path}`);
  if (path.endsWith('/products')) {
    productCalls++;
    if (mode === 'expired') return new Response('', { status: 401 });
    if (mode === 'persistent' || (mode === 'transient' && productCalls === 1)) return new Response('', { status: 500 });
    if (mode === 'stream') {
      const encoder = new TextEncoder(), line = (value: unknown) => encoder.encode(`${JSON.stringify(value)}\n`);
      const item = (i: number) => ({ documentId: `s${i}`, fields: { name: `Streamed product ${i}`, code: i, price: 5, category: 'cat' } });
      return new Response(new ReadableStream({ start(controller) {
        controller.enqueue(line({ type: 'total', total: 5 })); controller.enqueue(line({ type: 'items', data: [item(1), item(2)] }));
        releaseStream = () => { controller.enqueue(line({ type: 'items', data: [item(3), item(4), item(5)] })); controller.enqueue(line({ type: 'end', count: 5 })); controller.close(); };
      } }), { headers: { 'Content-Type': 'application/x-ndjson' } });
    }
    if (mode === 'broken') return new Response(`${JSON.stringify({ type: 'items', data: [{ documentId: 'b1', fields: { name: 'Partial product' } }] })}\n`,
      { headers: { 'Content-Type': 'application/x-ndjson' } });
    if (mode === 'large') return Response.json({ success: true, data: Array.from({ length: 250 }, (_, i) => ({ documentId: `p${i}`, fields: { name: `Bulk product ${i}`, code: i + 1, price: 10, category: 'cat' } })) });
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

  // Without a cached list the page shows streamed batches as they arrive.
  mode = 'stream'; clearMasterSnapshots(); button('Refresh').click();
  await waitFor(() => document.querySelector('tbody')?.textContent?.includes('Streamed product 2'), 'first streamed batch shows before the rest arrives');
  assert(document.querySelectorAll('tbody tr').length === 2, 'only the received batch is listed');
  assert(!document.querySelector('.products-stream-status'), 'no loading banner is shown above the list');
  assert(button('Refresh').disabled, 'Refresh waits for the full stream');
  releaseStream();
  await waitFor(() => document.querySelectorAll('tbody tr').length === 5 && !button('Refresh').disabled, 'remaining batches complete the list');
  assert(!button('Refresh').disabled, 'actions are available once every product has loaded');
  results.push('Streamed products appear batch by batch without a loading banner; full-list actions wait for the end of the stream');

  mode = 'broken'; clearMasterSnapshots(); const beforeBroken = productCalls; button('Refresh').click();
  await waitFor(() => document.querySelector('[role="alert"]')?.textContent?.includes('Unable to load products right now'), 'interrupted stream reports an error');
  assert(!document.querySelector('tbody') && productCalls === beforeBroken + 1, 'a partial list is never shown as complete and is not silently retried');
  results.push('A stream that ends without confirmation shows an error with Retry instead of a partial list');

  mode = 'large'; button('Refresh').click();
  const rows = () => document.querySelectorAll('tbody tr').length;
  await waitFor(() => document.querySelector('.products-more-rows'), 'large list loads');
  assert(rows() === 100 && document.querySelector('.products-more-rows')?.textContent?.includes('100 of 250'), 'large lists mount the first 100 rows only');
  // Scroll like a user: each batch moves the sentinel down until every row is mounted.
  // IntersectionObserver needs real frames, so run this suite with BROWSER_TEST_REALTIME=1.
  await waitFor(() => { window.scrollTo(0, document.body.scrollHeight); return rows() === 250 && !document.querySelector('.products-more-rows'); }, 'scrolling mounts the remaining rows');
  results.push('Large lists render in batches of 100 and load the rest while scrolling');

  mode = 'expired'; const before = productCalls; button('Refresh').click();
  await waitFor(() => expired === 1, 'expired session');
  assert(productCalls === before + 1, '401 not retried');
  results.push('Empty 401 response expires the session without a parse error or automatic retry');
  root.unmount(); document.getElementById('test-results')!.textContent = JSON.stringify({ passed: results });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), passed: results }); });
