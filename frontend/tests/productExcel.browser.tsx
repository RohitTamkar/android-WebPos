import { createRoot } from 'react-dom/client';
import ExcelJS from 'exceljs';
import { ProductsPage } from '../src/pages/ProductsPage.tsx';
import type { OutletSummary } from '../src/pages/OutletSelectionPage.tsx';
import '../src/index.css';

const results: string[] = [];
const requests: { path: string; body?: string }[] = [];
const products = [
  { documentId: 'p1', fields: { name: 'Apple', code: '001', category: 'c1' } },
  { documentId: 'p2', fields: { name: 'Banana', code: '002', category: 'c2' } },
];
let mode: 'success' | 'error' | 'expired' = 'success', expired = 0;
let downloaded: Blob | undefined, downloadName = '';
const originalCreate = URL.createObjectURL;
URL.createObjectURL = blob => { downloaded = blob as Blob; return originalCreate(blob); };
const originalClick = HTMLAnchorElement.prototype.click;
HTMLAnchorElement.prototype.click = function () { downloadName = this.download; };
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 20));
const waitFor = async (check: () => unknown, message: string) => {
  for (let i = 0; i < 200; i++) { if (check()) return; await pause(); }
  throw new Error(`Timed out: ${message}`);
};
window.fetch = async (url, init) => {
  const path = String(url);
  assert(new Headers(init?.headers).get('Authorization') === 'Bearer token', 'authenticated request');
  if (path === '/api/outlets/outlet/products') return Response.json({ success: true, data: products });
  if (path === '/api/outlets/outlet/categories') return Response.json({ success: true, data: [{ id: 'c1', name: 'Fruit' }, { id: 'c2', name: 'Other' }] });
  requests.push({ path, ...(init?.body ? { body: String(init.body) } : {}) });
  if (mode === 'expired') return Response.json({ success: false }, { status: 401 });
  if (mode === 'error') return Response.json({ success: false, message: 'Export provider unavailable.' }, { status: 503 });
  if (path === '/api/outlets/outlet/products/export/download') {
    assert(!init?.body && init?.method === 'GET', 'download sends no products or client filters');
    const book = new ExcelJS.Workbook();
    book.addWorksheet('Products').addRows([['Product Name', 'Search Code', 'AC price'], ['Apple', '001', 25], ['Banana', '002', 30]]);
    return new Response(new Uint8Array(await book.xlsx.writeBuffer()), { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } });
  }
  throw new Error(`Unexpected request: ${path}`);
};
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === text)!;
const click = async (node: HTMLElement) => { node.click(); await pause(); };
const value = async (node: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, value);
  node.dispatchEvent(new Event('input', { bubbles: true })); await pause();
};
const open = async () => {
  await click(document.querySelector<HTMLButtonElement>('[aria-label="More options"]')!);
  assert([...document.querySelectorAll('#products-more-menu [role="menuitem"]')].some(node => node.textContent?.trim() === 'Save Excel'), 'Save Excel is available in the product menu');
  await click(button('Save Excel'));
  await waitFor(() => document.querySelector('dialog[open]'), 'save dialog');
  assert(button('Download') && !button('Email') && !document.querySelector('dialog input[type="email"]'), 'only Download is offered');
};
const root = createRoot(document.getElementById('root')!);
root.render(<ProductsPage outlet={{ id: 'outlet', name: 'Outlet' } as OutletSummary} token="token" onSessionExpired={() => { expired++; }} />);
void (async () => {
  await waitFor(() => document.querySelector('section[aria-busy="false"]'), 'loaded products');
  await click(button('Fruit'));
  await value(document.querySelector<HTMLInputElement>('[aria-label="Search products"]')!, 'Apple');
  await open();
  const bounds = document.querySelector('dialog')!.getBoundingClientRect();
  assert(bounds.left >= 0 && bounds.right <= window.innerWidth, 'dialog fits viewport');
  await click(button('Cancel')); assert(requests.length === 0 && !document.querySelector('dialog'), 'cancel sends nothing');
  await open(); await click(button('Download'));
  await waitFor(() => downloaded && !document.querySelector('dialog'), 'download complete');
  assert(downloadName === 'Products.xlsx', 'xlsx filename');
  const book = new ExcelJS.Workbook(); await book.xlsx.load(await downloaded!.arrayBuffer());
  assert(book.getWorksheet('Products')!.rowCount === 3, 'download includes server products hidden by page filters');
  assert(book.worksheets.length === 1 && book.getWorksheet('Products')!.getCell('C2').value === 25, 'premises prices download alongside products without an extra worksheet');
  assert(!document.querySelector('.products-feedback, .products-notice'), 'Completed Excel download leaves no success banner');
  await open(); await click(button('Cancel'));
  assert(!document.querySelector('.products-feedback, .products-notice'), 'Completed download message does not reappear after another action');
  results.push('Save Excel menu, Download-only responsive dialog, cancel, authenticated XLSX download with inline premise prices and no leftover success message');

  await open(); mode = 'error'; await click(button('Download'));
  await waitFor(() => document.querySelector('dialog [role="alert"]'), 'download failure');
  assert(document.querySelector('dialog[open]'), 'download failure keeps dialog');
  await click(button('Cancel'));
  await open(); mode = 'expired'; await click(button('Download'));
  await waitFor(() => expired === 1, 'session expiry');
  await click(button('Cancel'));
  await click(document.querySelector<HTMLButtonElement>('[aria-label="More options"]')!);
  await click(button('Update Stockable & Weighable'));
  assert(document.querySelector('h1')?.textContent === 'Update Stockable & Weighable', 'existing stock screen still works');
  results.push('Export errors and session expiry handled; stockable/weighable menu still works');
  root.unmount(); URL.createObjectURL = originalCreate; HTMLAnchorElement.prototype.click = originalClick;
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed: results });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), passed: results }); });
