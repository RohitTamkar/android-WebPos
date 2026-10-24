import { createRoot } from 'react-dom/client';
import { TransferPreviewPage } from '../src/pages/TransferPreviewPage.tsx';
import type { OutletSummary } from '../src/pages/OutletSelectionPage.tsx';
import '../src/index.css';
const results: string[] = [];
const transfers: { mode: string; options: Record<string, boolean>; products: { sourceProductId: string }[]; categoryMappings: Record<string, string> }[] = [];
let failTransfer = false;
const data: Record<string, unknown> = {
  '/api/auth/outlets': { outlets: [{ id: 'source', name: 'Outlet A' }, { id: 'destination', name: 'Outlet B' }] },
  '/api/outlets/source/categories': [{ id: 'c1', name: 'ROLLS', categoryNo: 1 }, { id: 'c2', name: 'WRAPS', categoryNo: 2 }, { id: 'c3', name: 'SNACKS', categoryNo: 3 }],
  '/api/outlets/destination/categories': [{ id: 'd9', name: ' wraps ', categoryNo: 4 }],
  '/api/outlets/source/products': [{ documentId: 'p1', fields: { name: 'Roll', code: 1, category: 'c1', price: 40, priceTable: '{"default price":40}', taxIndex: 1, unitId: 2, currentStock: 5, weighable: true } },
    { documentId: 'p2', fields: { name: 'Samosa', code: 2, category: 'c3', taxIndex: 1, unitId: 2 } },
    { documentId: 'p3', fields: { name: 'Wrap', code: 3, category: 'c2', taxIndex: 1, unitId: 2 } }],
  '/api/outlets/destination/products': [{ documentId: 'x1', fields: { name: 'SAMOSA', code: 9 } }],
};
window.fetch = async (url, init) => {
  const path = String(url);
  assert(new Headers(init?.headers).get('Authorization') === 'Bearer mock-token', 'authenticated');
  if (path.endsWith('/transfer-preview/verify-quick-pin')) return Response.json({ success: true, data: { verified: true, destinationOutletId: 'destination', transferToken: 'grant' } });
  if (path === '/api/outlets/source/master-transfer') {
    const body = JSON.parse(String(init!.body)); transfers.push(body);
    await new Promise(resolve => setTimeout(resolve, 60));
    if (failTransfer) return Response.json({ success: false, message: 'Simulated transfer failure' }, { status: 503 });
    return Response.json({ success: true, data: { created: 1, skipped: 1, unchanged: 1, items: [{ type: 'product', sourceId: 'p1', name: 'Roll', status: 'created', reason: 'Product copied with stock 5.' },
      { type: 'product', sourceId: 'p3', name: 'VEG BURGER', status: 'already-transferred', reason: 'Product already present in the destination.' },
      { type: 'product', sourceId: 'p2', name: 'Wrap', status: 'skipped', reason: 'Possible destination name or barcode conflict. Existing product and stock preserved.' }] } });
  }
  if (Object.hasOwn(data, path)) return Response.json({ success: true, data: data[path] });
  throw new Error(`Unexpected request blocked: ${path}`);
};
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 25));
async function waitFor(check: () => unknown, message: string) { for (let i = 0; i < 150; i++) { if (check()) return; await pause(); } throw new Error(`Timed out: ${message}`); }
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === text)!;
const dialog = () => document.querySelector<HTMLDialogElement>('dialog.transfer-confirmation[open]');
const option = (label: string) => [...dialog()!.querySelectorAll<HTMLLabelElement>('.transfer-option')].find(node => node.querySelector('strong')?.textContent === label)!.querySelector('input')!;
const states = () => ['Stock', 'Weighable', 'Images', 'Assigned Taxes', 'Prices'].map(label => option(label).checked);
const click = async (element: HTMLElement) => { element.click(); await pause(); };
async function openReview() { await click(button('Review & transfer')); await waitFor(dialog, 'transfer dialog'); }
const root = createRoot(document.getElementById('root')!);
root.render(<TransferPreviewPage outlet={{ id: 'source', name: 'Outlet A' } as OutletSummary} token="mock-token" onSessionExpired={() => { throw new Error('unexpected expiry'); }} />);
void (async () => {
  await waitFor(() => document.querySelector('[aria-label="Select outlet Outlet B"]'), 'destinations');
  await click(document.querySelector<HTMLButtonElement>('[aria-label="Select outlet Outlet B"]')!);
  const pin = document.querySelector<HTMLInputElement>('#preview-quick-pin')!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(pin, '1234'); pin.dispatchEvent(new Event('input', { bubbles: true })); await pause();
  await click(button('Verify'));
  await waitFor(() => document.querySelector('input[aria-label="Select ROLLS"]'), 'category list');
  await click(document.querySelector<HTMLInputElement>('input[aria-label="Select ROLLS"]')!);
  const headings = [...document.querySelectorAll('.devices-table-scroll th')].map(th => th.textContent).join('|');
  assert(headings === 'Select|Category No.|Name|No. of Products|Regional Name', `category columns ${headings}`);
  assert(document.querySelector('.devices-table-scroll tbody tr')!.children[3]!.textContent === '1', 'product count per category');
  assert(!document.querySelector('[aria-label="Transfer summary"]'), 'no transfer summary for categories');
  results.push('Category table shows product count instead of image/destination number, with no transfer summary');

  await openReview();
  assert(dialog()!.textContent!.includes('Select data to transfer'), 'dialog heading');
  assert(dialog()!.textContent!.includes('Source outlet: Outlet A') && dialog()!.textContent!.includes('Destination outlet: Outlet B'), 'source and destination shown');
  assert(!dialog()!.querySelector('ul, small') && !dialog()!.textContent!.includes('linked product'), 'dialog shows only options and checkboxes');
  assert(JSON.stringify(states()) === '[false,false,true,false,false]', `defaults ${states()}`);
  assert(button('Cancel') && button('Continue Transfer'), 'Cancel and Continue Transfer buttons');
  results.push('Dialog shows only outlets and the five options; only Images (existing behavior) starts checked');

  await click(option('Stock')); await click(option('Prices'));
  assert(JSON.stringify(states()) === '[true,false,true,false,true]', 'options toggle independently');
  await click(button('Cancel'));
  assert(!dialog() && transfers.length === 0, 'cancel does not transfer');
  results.push('Checkboxes are independent; Cancel performs no transfer');

  await openReview();
  assert(JSON.stringify(states()) === '[true,false,true,false,true]', 'choices kept while on the page');
  const continueButton = button('Continue Transfer'); continueButton.click(); continueButton.click(); await pause();
  await waitFor(() => document.querySelector('#transfer-outcome-title')?.textContent === 'Transfer partially completed', 'result after backend confirmation');
  assert(document.querySelector('dialog[open] .transfer-outcome-skipped')?.textContent?.includes('Wrap: Possible destination name or barcode conflict'), 'popup lists skipped product with reason');
  assert(document.querySelector('dialog[open] .transfer-outcome-present')?.textContent?.includes('VEG BURGER: Product is already present in the destination.'), 'popup lists already present products');
  assert(!document.querySelector('dialog[open] .transfer-outcome-skipped')?.textContent?.includes('VEG BURGER'), 'already present is not listed as not copied');
  assert(transfers.length === 1, 'duplicate click sends one request');
  assert(transfers[0]!.mode === 'categories' && JSON.stringify(transfers[0]!.options) === '{"stock":true,"weighable":false,"images":true,"taxes":false,"prices":true}', 'category options sent');
  await click(button('OK'));
  results.push('Continue sends the chosen options once and shows success only after the backend confirms');

  await click(button('Product Transfer'));
  await waitFor(() => document.querySelector('input[aria-label="Select Roll"]'), 'product list');
  await click(document.querySelector<HTMLInputElement>('input[aria-label="Select Roll"]')!);
  await openReview();
  assert(!document.querySelector('[aria-label="Transfer summary"]'), 'no transfer summary for products');
  for (const label of ['Stock', 'Weighable', 'Assigned Taxes', 'Prices']) if (!option(label).checked) await click(option(label));
  assert(JSON.stringify(states()) === '[true,true,true,true,true]', 'all five selected');
  failTransfer = true; await click(button('Continue Transfer'));
  await waitFor(() => document.body.textContent!.includes('Simulated transfer failure'), 'failure message');
  assert(!document.querySelector('#transfer-outcome-title[open], dialog[open] #transfer-outcome-title'), 'no success on failure');
  assert(JSON.stringify(transfers[1]!.options) === '{"stock":true,"weighable":true,"images":true,"taxes":true,"prices":true}' && transfers[1]!.products[0]!.sourceProductId === 'p1', 'product options sent');
  results.push('Product Transfer sends all five options; failures show an error without success');
  failTransfer = false;
  const productRow = (name: string) => document.querySelector<HTMLInputElement>(`input[aria-label="Select ${name}"]`)!;
  assert(productRow('Samosa').disabled && productRow('Samosa').closest('tr')!.textContent!.includes('Already present'), 'present product cannot be selected');
  await click(productRow('Wrap'));
  assert(/Existing category:\s+wraps/.test(document.body.textContent!), 'new product goes into the same-named existing category');
  await click(productRow('Roll')); await openReview(); await click(button('Continue Transfer'));
  await waitFor(() => transfers.length === 3, 'third transfer');
  assert(JSON.stringify(transfers[2]!.categoryMappings) === '{"c2":"d9"}', `category mapped instead of duplicated ${JSON.stringify(transfers[2]!.categoryMappings)}`);
  await waitFor(() => button('OK'), 'outcome'); await click(button('OK'));
  results.push('Product Transfer disables products already present and maps new products to the existing category');

  await click(button('Category Transfer'));
  await waitFor(() => document.querySelector('input[aria-label="Select WRAPS"]'), 'categories again');
  const wraps = document.querySelector<HTMLInputElement>('input[aria-label="Select WRAPS"]')!;
  assert(wraps.disabled && wraps.closest('tr')!.textContent!.includes('Already present'), 'present category cannot be selected');
  await click(document.querySelector<HTMLInputElement>('input[aria-label="Select SNACKS"]')!);
  assert(document.querySelector('[role="alert"]')?.textContent?.includes('Already present in the destination: Samosa'), 'linked present product explained');
  assert(button('Review & transfer').disabled, 'transfer disabled when a linked product is already present');
  results.push('Category Transfer disables present categories and blocks categories whose products are already present');
  root.unmount(); document.getElementById('test-results')!.textContent = JSON.stringify({ passed: results });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), passed: results }); });
