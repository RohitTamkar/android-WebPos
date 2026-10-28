import { createRoot } from 'react-dom/client';
import { ProductsPage } from '../src/pages/ProductsPage.tsx';
import type { OutletSummary } from '../src/pages/OutletSelectionPage.tsx';
import '../src/index.css';
const results: string[] = [];
const patches: { id: string; body: { prices: Record<string, number>; expected: Record<string, unknown> } }[] = [];
let expired = 0, listLoads = 0, confirmAnswer = false, confirms = 0;
const failIds = new Set<string>();
const store = new Map<string, Record<string, unknown>>([
  ['p1', { name: 'MASALA PAPAD', code: '1', price: 80, currentStock: 5, barcode: 'b1', priceTable: '{"default price":80,"AC Table price":30,"TABLE price":80}' }],
  ['p2', { name: 'FRY PAPAD', code: '2', price: 30, currentStock: 6, barcode: 'b2', priceTable: '{"default price":30,"AC Table price":30,"TABLE price":30,"Online price":30}' }],
  ['p3', { name: 'ONION SALAD', code: '3', price: 50, currentStock: 7, barcode: 'b3', priceTable: '{"default price":50}' }],
  ['p4', { name: 'BROKEN', code: '4', price: 1, priceTable: 'not json' }],
]);
const untouched = structuredClone([...store]);
window.confirm = () => { confirms++; return confirmAnswer; };
window.fetch = async (url, init) => {
  const path = String(url);
  if (path === '/api/outlets/outlet/products' && !init?.method) { listLoads++; return Response.json({ success: true, data: [...store].map(([documentId, fields]) => ({ documentId, fields: { ...fields } })) }); }
  if (path === '/api/outlets/outlet/premises') return Response.json({ success: true, data: { premises: ['AC Table', 'TABLE', 'Online'].map(name => ({ fields: { name } })) } });
  if (path === '/api/outlets/outlet/categories') return Response.json({ success: true, data: [] });
  const match = path.match(/^\/api\/outlets\/outlet\/products\/(p\d)\/prices$/);
  if (match && init?.method === 'PATCH') {
    const id = match[1]!, body = JSON.parse(String(init.body)); patches.push({ id, body });
    assert((init.headers as Record<string, string>).Authorization === 'Bearer mock-token', 'authorized update');
    if (expired < 0) return Response.json({ success: false }, { status: 401 });
    if (failIds.has(id)) return Response.json({ success: false, message: 'Prices changed since you loaded the products.' }, { status: 409 });
    const fields = store.get(id)!, table = { ...JSON.parse(String(fields.priceTable)), ...body.prices };
    store.set(id, { ...fields, priceTable: JSON.stringify(table), ...('default price' in body.prices ? { price: body.prices['default price'] } : {}) });
    return Response.json({ success: true, data: { documentId: id, fields: store.get(id) } });
  }
  throw new Error(`Unexpected request blocked: ${init?.method ?? 'GET'} ${path}`);
};
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 20));
async function waitFor(check: () => unknown, message: string) { for (let i = 0; i < 150; i++) { if (check()) return; await pause(); } throw new Error(`Timed out: ${message}`); }
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === text)!;
const field = (label: string) => document.querySelector<HTMLInputElement>(`[aria-label="${label}"]`);
const click = async (element: HTMLElement) => { element.click(); await pause(); };
async function type(element: HTMLInputElement, text: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, text);
  element.dispatchEvent(new Event('input', { bubbles: true })); await pause();
}
const alertText = () => document.querySelector('[role="alert"]')?.textContent ?? '';
async function openScreen() {
  await waitFor(() => document.querySelector('section[aria-busy="false"] [aria-label="More options"]'), 'products ready');
  await click(field('More options')!);
  await click(button('Update Bulk Price'));
  await waitFor(() => field('Online for ONION SALAD'), 'bulk price screen with configured premises');
}
const root = createRoot(document.getElementById('root')!);
root.render(<ProductsPage outlet={{ id: 'outlet' } as OutletSummary} token="mock-token" onSessionExpired={() => { expired++; }} />);
void (async () => {
  await openScreen();
  assert([...document.querySelectorAll<HTMLInputElement>('.price-table input[type="text"]')].every(input => !input.hasAttribute('placeholder')), 'Price boxes have no Default placeholder text');
  const headings = [...document.querySelectorAll('.price-table th')].map(th => th.textContent);
  assert(JSON.stringify(headings) === JSON.stringify(['Product Name', 'Same for all', 'Default Price', 'AC Table', 'TABLE', 'Online']), `columns ${headings}`);
  assert(field('AC Table for MASALA PAPAD')!.value === '30' && field('TABLE for MASALA PAPAD')!.value === '80', 'stored premise prices shown');
  assert(field('AC Table for ONION SALAD') && field('Online for ONION SALAD') && field('Default Price for ONION SALAD')!.value === '50', 'Every configured premises has an editable input even without a saved value');
  await click(field('Same price for all premises for ONION SALAD')!);
  assert(field('Online for ONION SALAD')!.value === '50', 'Same for all fills previously missing premises');
  await type(field('Online for ONION SALAD')!, '65');
  assert(!field('Same price for all premises for ONION SALAD')!.checked, 'Independent premises edit unlinks the checkbox');
  await click(field('Same price for all premises for ONION SALAD')!);
  await click(button('Update'));
  await waitFor(() => field('More options'), 'save new premises prices');
  assert(patches.some(patch => patch.id === 'p3' && patch.body.expected['Online price'] === null), 'New premise prices use a missing-value expectation');
  patches.length = 0; await openScreen();
  assert(field('Same price for all premises for FRY PAPAD')!.checked && !field('TABLE for FRY PAPAD')!.disabled, 'equal prices start linked');
  assert(!field('Same price for all premises for MASALA PAPAD')!.checked, 'different prices start unlinked');
  assert(!field('Default Price for BROKEN') && document.body.textContent!.includes('Price table is invalid'), 'invalid table is read-only');
  results.push('Screen lists all products with default and premise prices from priceTable');

  await type(field('Default Price for FRY PAPAD')!, '35');
  assert(field('AC Table for FRY PAPAD')!.value === '35' && field('TABLE for FRY PAPAD')!.value === '35', 'linked default mirrors to premises');
  await type(field('AC Table for MASALA PAPAD')!, '35'); await type(field('TABLE for MASALA PAPAD')!, 'abc');
  await click(button('Update'));
  assert(alertText().includes('MASALA PAPAD') && patches.length === 0, 'invalid price blocks update');
  await type(field('TABLE for MASALA PAPAD')!, '90');
  results.push('Same-for-all mirrors default price; invalid input blocks saving');

  failIds.add('p2');
  await click(button('Update'));
  await waitFor(() => alertText().includes('1 of 2 products updated; 1 failed'), 'partial failure');
  const sent = Object.fromEntries(patches.map(patch => [patch.id, patch.body]));
  assert(JSON.stringify(sent.p1) === JSON.stringify({ prices: { 'AC Table price': 35, 'TABLE price': 90 }, expected: { 'AC Table price': 30, 'TABLE price': 80 } }), `p1 payload ${JSON.stringify(sent.p1)}`);
  assert(JSON.stringify(sent.p2) === JSON.stringify({ prices: { 'default price': 35, 'AC Table price': 35, 'TABLE price': 35, 'Online price': 35 }, expected: { 'default price': 30, 'AC Table price': 30, 'TABLE price': 30, 'Online price': 30 } }), `p2 payload ${JSON.stringify(sent.p2)}`);
  assert(field('Default Price for FRY PAPAD')!.value === '35', 'failed edits kept');
  results.push('Update sends only changed keys with expected values and reports partial failure');

  failIds.clear(); patches.length = 0;
  await click(button('Update'));
  await waitFor(() => document.querySelector('[aria-label="More options"]'), 'return to Products');
  assert(!document.querySelector('.products-notice'), 'Completed update leaves no success banner');
  assert(patches.length === 1 && patches[0]!.id === 'p2', 'retry resends only the failed product');
  await waitFor(() => listLoads === 3, 'list reloaded');
  assert(store.get('p1')!.priceTable === '{"default price":80,"AC Table price":35,"TABLE price":90}' && store.get('p2')!.price === 35, 'saved values');
  for (const [id, fields] of untouched) for (const key of ['name', 'code', 'currentStock', 'barcode']) assert(store.get(id)![key] === fields[key], `${id}.${key} preserved`);
  results.push('Retry saves remaining product, reloads list, and preserves unrelated fields');

  await openScreen();
  assert(field('TABLE for MASALA PAPAD')!.value === '90', 'reopened with saved values');
  await type(field('Default Price for ONION SALAD')!, '55');
  await click(button('Cancel')); assert(confirms === 1 && field('Default Price for ONION SALAD'), 'declined discard stays');
  confirmAnswer = true; await click(button('Cancel'));
  await waitFor(() => field('More options'), 'back to products');
  await openScreen(); await click(button('Update'));
  assert(document.querySelector('.products-notice')?.textContent === 'No price changes to update.' && patches.length === 1, 'cancel and no-op send nothing');
  await type(field('Default Price for ONION SALAD')!, '55'); expired = -1; await click(button('Update'));
  await waitFor(() => expired === 0, 'expired session handled');
  results.push('Cancel confirms before discarding; no-op sends nothing; expired session handled');
  root.unmount(); document.getElementById('test-results')!.textContent = JSON.stringify({ passed: results });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), passed: results }); });
