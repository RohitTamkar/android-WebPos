import { createRoot } from 'react-dom/client';
import { ProductsPage } from '../src/pages/ProductsPage.tsx';
import type { OutletSummary } from '../src/pages/OutletSelectionPage.tsx';
import '../src/index.css';
const results: string[] = [];
const patches: { id: string; body: Record<string, unknown> }[] = [];
let expired = 0, listLoads = 0, confirmAnswer = false, confirms = 0;
const failIds = new Set<string>();
const store = new Map(Object.entries({
  p1: { name: 'Apple', code: '1', stockable: true, weighable: false, price: 50, currentStock: 35, barcode: 'b1', category: 'c1' },
  p2: { name: 'Banana', code: '2', stockable: false, weighable: true, price: 20, currentStock: 4, barcode: 'b2', category: 'c1' },
  p3: { name: 'Cherry', code: '3', price: 30, currentStock: 9, barcode: 'b3', category: 'c1' },
}) as [string, Record<string, unknown>][]);
const untouched = structuredClone([...store]);
const list = () => [...store].map(([documentId, fields]) => ({ documentId, fields: { ...fields } }));
window.confirm = () => { confirms++; return confirmAnswer; };
window.fetch = async (url, init) => {
  const path = String(url);
  if (path === '/api/outlets/outlet/products' && !init?.method) { listLoads++; return Response.json({ success: true, data: list() }); }
  if (path === '/api/outlets/outlet/categories') return Response.json({ success: true, data: [{ id: 'c1', name: 'Fruit' }] });
  const match = path.match(/^\/api\/outlets\/outlet\/products\/(p\d)$/);
  if (match && init?.method === 'PATCH') {
    const id = match[1]!, body = JSON.parse(String(init.body)); patches.push({ id, body });
    assert((init.headers as Record<string, string>).Authorization === 'Bearer mock-token', 'authorized update');
    if (expired < 0) return Response.json({ success: false }, { status: 401 });
    if (failIds.has(id)) return Response.json({ success: false, message: 'Server rejected this product.' }, { status: 422 });
    store.set(id, { ...store.get(id), ...body });
    return Response.json({ success: true, data: { documentId: id, fields: store.get(id) } });
  }
  throw new Error(`Unexpected request blocked: ${init?.method ?? 'GET'} ${path}`);
};
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 20));
async function waitFor(check: () => unknown, message: string) { for (let i = 0; i < 150; i++) { if (check()) return; await pause(); } throw new Error(`Timed out: ${message}`); }
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === text)!;
const box = (label: string) => document.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
const header = (column: 'Stock' | 'Weighable') => box(`Select ${column} for all products`);
const column = (column: 'Stock' | 'Weighable') => ['Apple', 'Banana', 'Cherry'].map(name => box(`${column} for ${name}`).checked);
const click = async (element: HTMLElement) => { element.click(); await pause(); };
const search = async (value: string) => {
  const input = box('Search Product');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await pause();
};
async function openScreen() {
  await waitFor(() => document.querySelector('section[aria-busy="false"] [aria-label="More options"]'), 'products ready');
  await click(box('More options'));
  await waitFor(() => button('Update Stockable & Weighable') && !button('Update Stockable & Weighable').disabled, 'menu item enabled');
  await click(button('Update Stockable & Weighable'));
  await waitFor(() => header('Stock'), 'bulk screen');
}
const root = createRoot(document.getElementById('root')!);
root.render(<ProductsPage outlet={{ id: 'outlet' } as OutletSummary} token="mock-token" onSessionExpired={() => { expired++; }} />);
void (async () => {
  await openScreen();
  assert(document.querySelector('h1')?.textContent === 'Update Stockable & Weighable', 'title');
  assert(button('Update') && button('Cancel'), 'top buttons');
  assert(JSON.stringify(column('Stock')) === '[true,false,false]' && JSON.stringify(column('Weighable')) === '[false,true,false]', 'stored values shown; missing flags read as false');
  assert(header('Stock').indeterminate && !header('Stock').checked && header('Weighable').indeterminate, 'partial header state');
  results.push('Menu opens the screen showing all products with stored flag values and indeterminate headers');

  assert([...document.querySelectorAll('.flags-table .products-name')].map(node => node.textContent).join(',') === 'Apple,Banana,Cherry', 'product names omit code suffixes');
  await click(box('Stock for Cherry'));
  await search('  aPp  ');
  assert(document.querySelectorAll('.flags-table tbody tr').length === 1 && box('Stock for Apple'), 'instant case-insensitive name search trims whitespace');
  assert(header('Stock').indeterminate && !header('Stock').checked, 'header still reflects hidden products');
  await search('no matching product');
  assert(document.querySelector('.flags-empty')?.textContent === 'No products match your search.', 'no-match feedback');
  await search('1');
  assert(document.querySelector('.flags-empty'), 'search matches names rather than codes');
  await search('');
  assert(box('Stock for Cherry').checked && box('Weighable for Banana').checked, 'clearing search restores unsaved and stored selections');
  await click(box('Stock for Cherry'));
  assert(patches.length === 0 && listLoads === 1 && JSON.stringify([...store]) === JSON.stringify(untouched), 'search does not write, reload, or mutate products');
  results.push('Name search preserves selections, omits code suffixes, and handles no matches without changing data');

  await search('Apple');
  await click(header('Stock'));
  assert(header('Stock').checked, 'filtered header selects all products');
  await search('');
  assert(JSON.stringify(column('Stock')) === '[true,true,true]' && header('Stock').checked && !header('Stock').indeterminate, 'stock select all');
  assert(JSON.stringify(column('Weighable')) === '[false,true,false]', 'weighable untouched by stock header');
  await click(header('Weighable')); await click(header('Weighable'));
  assert(JSON.stringify(column('Weighable')) === '[false,false,false]' && !header('Weighable').indeterminate, 'weighable clear all');
  assert(JSON.stringify(column('Stock')) === '[true,true,true]', 'stock untouched by weighable header');
  await click(box('Stock for Banana'));
  assert(header('Stock').indeterminate && JSON.stringify(column('Weighable')) === '[false,false,false]', 'individual toggles update header only for that column');
  results.push('Header checkboxes select/clear only their own column; individual toggles update header state');

  await click(button('Cancel'));
  assert(confirms === 1 && header('Stock'), 'declined discard keeps screen');
  confirmAnswer = true; await click(button('Cancel'));
  await waitFor(() => box('More options'), 'back on products');
  assert(patches.length === 0, 'cancel saves nothing');
  await openScreen();
  assert(JSON.stringify(column('Stock')) === '[true,false,false]', 'reopening discards unsaved changes');
  results.push('Cancel asks before discarding, then returns without writing');

  await click(box('Stock for Cherry')); await click(box('Weighable for Cherry')); await click(box('Weighable for Banana'));
  failIds.add('p2');
  await search('Cherry');
  await click(button('Update'));
  await waitFor(() => document.querySelector('[role="alert"]'), 'partial failure report');
  await search('');
  assert(document.querySelector('[role="alert"]')!.textContent!.includes('1 of 2 products updated; 1 failed'), 'partial summary');
  assert(document.querySelector('[aria-label="Failed products"]')!.textContent!.includes('Banana'), 'failed product named');
  assert(JSON.stringify(patches.map(patch => [patch.id, patch.body])) === JSON.stringify([['p3', { stockable: true, weighable: true }], ['p2', { weighable: false }]])
    || JSON.stringify(patches.map(patch => [patch.id, patch.body])) === JSON.stringify([['p2', { weighable: false }], ['p3', { stockable: true, weighable: true }]]), 'only changed flags sent');
  assert(!box('Weighable for Banana').checked, 'failed selection kept for retry');
  results.push('Update sends only changed flags and reports partial failures by product');

  failIds.clear(); patches.length = 0;
  await click(button('Update'));
  await waitFor(() => document.querySelector('[aria-label="More options"]'), 'return to Products');
  assert(!document.querySelector('.products-notice'), 'Completed update leaves no success banner');
  assert(JSON.stringify(patches) === JSON.stringify([{ id: 'p2', body: { weighable: false } }]), 'retry resends only failed product');
  await waitFor(() => listLoads === 2, 'product list reloaded');
  for (const [id, fields] of untouched) {
    const now = store.get(id)!;
    for (const key of ['name', 'code', 'price', 'currentStock', 'barcode', 'category']) assert(now[key] === fields[key], `${id}.${key} preserved`);
  }
  results.push('Retry updates only remaining product, reloads list, and preserves unrelated fields');

  await openScreen(); await click(button('Update'));
  assert(document.querySelector('.products-notice')?.textContent === 'No changes to update.' && patches.length === 1, 'no-op update');
  await click(box('Stock for Apple')); expired = -1; await click(button('Update'));
  await waitFor(() => expired === 0, 'expired session handled');
  results.push('No-op update sends nothing; expired session is handled');
  root.unmount(); document.getElementById('test-results')!.textContent = JSON.stringify({ passed: results });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), passed: results }); });
