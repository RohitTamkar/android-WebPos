import { createRoot } from 'react-dom/client';
import { ProductsPage } from '../src/pages/ProductsPage.tsx';
import type { OutletSummary } from '../src/pages/OutletSelectionPage.tsx';
import '../src/index.css';
const results: string[] = [];
const deletes: { path: string; body: unknown }[] = [];
let stored = [
  { documentId: 'p1', fields: { code: '1', name: 'Tea', category: 'deleted-category' } },
  { documentId: 'p2', fields: { code: '2', name: 'Coffee', category: 'deleted-category' } },
];
let fail = true, expired = 0;
window.fetch = async (url, init) => {
  const path = String(url);
  if (path === '/api/outlets/outlet/products' && init?.method === 'DELETE') {
    deletes.push({ path, body: JSON.parse(String(init.body)) });
    assert(new Headers(init.headers).get('Authorization') === 'Bearer mock-token', 'authorized delete');
    if (fail) { fail = false; return Response.json({ success: false, message: '1 of 2 deleted before an error. Retry Delete All to remove the rest.' }, { status: 503 }); }
    stored = []; return Response.json({ success: true, data: { deleted: 2 } });
  }
  if (path === '/api/outlets/outlet/products') return Response.json({ success: true, data: stored });
  // Categories were deleted: products keep their category field and must still show under All.
  if (path === '/api/outlets/outlet/categories') return Response.json({ success: true, data: [] });
  throw new Error(`Unexpected request blocked: ${init?.method ?? 'GET'} ${path}`);
};
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 20));
async function waitFor(check: () => unknown, message: string) { for (let i = 0; i < 150; i++) { if (check()) return; await pause(); } throw new Error(`Timed out: ${message}`); }
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === text);
const names = () => [...document.querySelectorAll('.products-table tbody .products-name')].map(cell => cell.textContent?.trim()).join(',');
const dialogText = () => document.querySelector('dialog[open]')?.textContent ?? '';
const click = async (element: Element | null | undefined) => { (element as HTMLElement).click(); await pause(); };
async function openDeleteAll() {
  await click(document.querySelector('[aria-label="More options"]'));
  const items = [...document.querySelectorAll('#products-more-menu [role="menuitem"]')];
  assert(items.at(-1)?.textContent?.trim() === 'Delete All', 'Delete All is the last menu item');
  await click(button('Delete All'));
  await waitFor(() => dialogText().includes('Are you sure you want to delete all products?'), 'confirmation');
}
const root = createRoot(document.getElementById('root')!);
root.render(<ProductsPage outlet={{ id: 'outlet' } as OutletSummary} token="mock-token" onSessionExpired={() => { expired++; }} />);
void (async () => {
  await waitFor(() => names() === 'Tea,Coffee', 'products with deleted categories listed under All');
  assert(document.querySelector('.products-category-tabs .selected')?.textContent === 'All', 'All tab selected');
  results.push('Products whose categories were deleted remain listed under All');

  await openDeleteAll();
  assert(button('Yes') && button('No') && dialogText().includes('every category'), 'Confirmation explains product and category deletion');
  await click(button('No'));
  assert(!document.querySelector('dialog[open]') && deletes.length === 0 && names() === 'Tea,Coffee', 'No keeps products');
  results.push('Delete All is last in the menu; No closes without deleting');

  await openDeleteAll(); await click(button('Yes'));
  await waitFor(() => dialogText().includes('Retry Delete All'), 'failure shown in dialog');
  assert(names() === 'Tea,Coffee', 'failed delete keeps list');
  await click(button('Yes'));
  await waitFor(() => dialogText().includes('All products and categories deleted successfully'), 'success message');
  assert(deletes.length === 2 && deletes.every(request => JSON.stringify(request.body) === '{"confirm":"DELETE_ALL_PRODUCTS"}'), 'confirmed requests');
  await click(button('OK'));
  await waitFor(() => !document.querySelector('dialog[open]') && !names(), 'list empty after delete');
  await click(document.querySelector('[aria-label="More options"]'));
  assert(button('Delete All')?.disabled, 'Delete All disabled when no products remain');
  assert(expired === 0, 'no session expiry');
  results.push('Yes sends a confirmed delete, reports failure, then deletes all and shows the success message');
  root.unmount(); document.getElementById('test-results')!.textContent = JSON.stringify({ passed: results });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), passed: results }); });
