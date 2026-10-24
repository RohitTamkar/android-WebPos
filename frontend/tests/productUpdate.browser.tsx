import { createRoot } from 'react-dom/client';
import { ProductsPage } from '../src/pages/ProductsPage.tsx';
import type { OutletSummary } from '../src/pages/OutletSelectionPage.tsx';
import '../src/index.css';
const results: string[] = [];
const patches: { path: string; body: Record<string, unknown> }[] = [];
let expired = 0;
let mode: 'failure' | 'success' | 'expired' = 'failure';
let product = { documentId: 'p1', fields: { id: 'p1', code: '00196', name: 'Product Original', price: 50,
  mrpPrice: 60, costPrice: 20, category: 'c1', regionalName: 'Local', discount: 5, shortName: 'Short',
  taxIndex: 7, hsnCode: '123', unitId: 2, weighable: false, stockable: true, currentStock: 35,
  barcode: '00000123456', priceTable: '{"default price":50,"Wholesale":40,"AC Table price":40,"TABLE price":50}', onlineSynced: true,
  wholeSaleAmount: 40, onlinePrice: 60, kitchenId: 'kitchen', recipeId: 'recipe' } };
const other = { documentId: 'p2', fields: { name: 'Other', code: 999, category: 'c2', price: 10 } };
const categories = [{ id: 'c1', name: 'Food' }, { id: 'c2', name: 'Drinks' }];
window.fetch = async (url, init) => {
  const path = String(url);
  if (path === '/api/outlets/outlet/products') return Response.json({ success: true, data: [product, other] });
  if (path === '/api/outlets/outlet/categories') return Response.json({ success: true, data: categories });
  if (path === '/api/outlets/outlet/products/p1/edit-options') {
    return Response.json({ success: true, data: { code: product.fields.code, categories, product, servicePointName: 'Kitchen Printer',
      taxes: [{ percent: 5, index: 7, type: 0 }, { percent: 0, index: 1, type: 0 }], units: [{ id: 2, name: 'number' }],
      premises: [{ id: 'ac', name: 'AC Table' }, { id: 'table', name: 'TABLE' }] } });
  }
  if (path === '/api/outlets/outlet/products/p1' && init?.method === 'PATCH') {
    const body = JSON.parse(String(init.body)); patches.push({ path, body });
    assert((init.headers as Record<string, string>).Authorization === 'Bearer mock-token', 'authorized update');
    await new Promise(resolve => setTimeout(resolve, 80));
    if (mode === 'failure') return Response.json({ success: false, message: 'Update failed. Retry.', errors: { price: 'Price could not be saved.' } }, { status: 503 });
    if (mode === 'expired') return Response.json({ success: false }, { status: 401 });
    product = { ...product, fields: { ...product.fields, ...body } };
    return Response.json({ success: true, data: product });
  }
  throw new Error(`Unexpected request blocked: ${path}`);
};
const root = createRoot(document.getElementById('root')!);
const onExpired = () => { expired++; };
root.render(<ProductsPage outlet={{ id: 'outlet' } as OutletSummary} token="mock-token" onSessionExpired={onExpired} />);
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 20));
async function waitFor(check: () => unknown, message: string) { for (let i = 0; i < 120; i++) { if (check()) return; await pause(); } throw new Error(`Timed out: ${message}`); }
function input(id: string) { return document.getElementById(id) as HTMLInputElement; }
function button(text: string) { return [...document.querySelectorAll('button')].find(button => button.textContent === text)!; }
function edit() { return document.querySelector<HTMLButtonElement>('[aria-label="Edit product"]')!; }
async function value(el: HTMLInputElement | HTMLSelectElement, text: string) {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, text);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); await pause();
}
async function open() { edit().click(); await waitFor(() => input('product-code')?.value === '00196', 'prefilled edit options'); }
void (async () => {
  await waitFor(() => edit(), 'product list');
  await value(document.querySelector<HTMLInputElement>('[aria-label="Search products"]')!, 'Product');
  await value(document.querySelector<HTMLSelectElement>('[aria-label="Filter by category"]')!, 'c1');
  await open();
  assert(document.getElementById('add-product-title')?.textContent === 'Edit Product', 'edit heading');
  assert(input('product-code').readOnly, 'code is read-only');
  const expected = { name: 'Product Original', price: '50', mrpPrice: '60', costPrice: '20', category: 'c1',
    regionalName: 'Local', discount: '5', shortName: 'Short', taxIndex: '7', hsnCode: '123', unitId: '2' };
  for (const [key, text] of Object.entries(expected)) assert(input(`product-${key}`).value === text, `${key} is prefilled`);
  assert(input('product-wholeSaleAmount').value === '40' && input('product-onlinePrice').value === '60', 'saved additional prices displayed');
  assert(input('product-barcode').value === '00000123456' && input('product-barcode').readOnly, 'barcode string preserved');
  assert(input('product-kitchenId').value === 'Kitchen Printer' && input('product-kitchenId').readOnly, 'service point name displayed read-only instead of its ID');
  assert(product.fields.kitchenId === 'kitchen' && input('product-recipeId').value === 'recipe', 'saved service point ID and recipe preserved');
  const taxOptions = [...document.querySelectorAll<HTMLOptionElement>('#product-taxIndex option')].filter(option => option.value);
  assert(taxOptions.length === 12 && taxOptions[5]!.value === '6' && taxOptions[5]!.textContent === 'VAT 22'
    && taxOptions[6]!.value === '7' && taxOptions[6]!.textContent === 'VAT 10', 'Product selector uses all Android GST and VAT IDs');
  assert(document.querySelector('.modal-body')?.lastElementChild?.classList.contains('local-image-picker'), 'image upload is the last section');
  assert(document.querySelectorAll('[aria-label="AC Table Price"]').length === 1
    && document.querySelector<HTMLInputElement>('[aria-label="AC Table Price"]')!.value === '40', 'phone-saved AC Table price displays once with its saved value');
  assert(document.querySelectorAll('[aria-label="TABLE Price"]').length === 1
    && document.querySelector<HTMLInputElement>('[aria-label="TABLE Price"]')!.value === '50', 'phone-saved TABLE price displays once with its saved value');
  assert(!document.querySelector('[aria-label="AC Table price Price"]'), 'price suffix is not repeated');
  assert(!document.querySelector('details'), 'all fields visible');
  assert(!document.querySelector<HTMLInputElement>('[aria-label="Weighable"]')!.checked
    && document.querySelector<HTMLInputElement>('[aria-label="Stockable"]')!.checked, 'existing checkbox values preserved');
  await value(input('product-name'), 'Discard'); button('Cancel').click(); await pause();
  assert(patches.length === 0 && !input('product-name'), 'Cancel does not save');
  await open(); assert(input('product-name').value === 'Product Original', 'cancelled draft discarded');
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); await pause();
  assert(!input('product-name') && patches.length === 0, 'Escape cancels');
  results.push('Edit reuses all Add Product fields with existing values and read-only code; Cancel/Escape do not save');

  await open(); await value(input('product-name'), ''); button('Update').click(); await pause();
  assert(input('product-name').getAttribute('aria-invalid') === 'true', 'required name validation');
  await value(input('product-name'), 'Product Updated'); await value(input('product-price'), '-1'); button('Update').click(); await pause();
  assert(input('product-price').getAttribute('aria-invalid') === 'true' && patches.length === 0, 'invalid number prevents PATCH');
  await value(input('product-price'), '55.5'); await value(input('product-regionalName'), 'Regional Updated');
  await value(input('product-taxIndex'), '1');
  document.querySelector<HTMLInputElement>('[aria-label="Weighable"]')!.click();
  document.querySelector<HTMLInputElement>('[aria-label="Stockable"]')!.click(); await pause();
  const update = button('Update'); update.click(); update.click(); await pause();
  assert(patches.length === 1, 'duplicate clicks issue one update');
  assert(button('Cancel').disabled, 'cannot leave during update');
  await waitFor(() => document.querySelector('[role="alert"]')?.textContent?.includes('Update failed'), 'failure shown');
  assert(input('product-name').value === 'Product Updated', 'failed update keeps draft');
  assert(input('product-price').getAttribute('aria-invalid') === 'true', 'server field errors visible');
  assert(JSON.stringify(patches[0]!.body) === JSON.stringify({ name: 'Product Updated', price: 55.5, regionalName: 'Regional Updated', taxIndex: 1, weighable: true, stockable: false }), 'only changed editable fields submitted');
  assert(patches[0]!.path.endsWith('/p1'), 'existing product document targeted');
  results.push('Validation, editable checkboxes, changed-field-only PATCH, duplicate-click guard and failure recovery');

  mode = 'success'; button('Update').click(); await waitFor(() => !input('product-name'), 'update returns to list');
  assert(document.querySelector('tbody')?.textContent?.includes('Product Updated'), 'updated product shown');
  assert(document.querySelector('tbody')?.textContent?.includes('55.5'), 'updated price shown');
  assert(document.querySelector('tbody')?.textContent?.includes('00196'), 'existing code retained');
  assert(document.querySelector('[role="status"]')?.textContent?.includes('Product updated successfully'), 'success message');
  assert(document.querySelector<HTMLInputElement>('[aria-label="Search products"]')!.value === 'Product', 'search preserved');
  assert(document.querySelector<HTMLSelectElement>('[aria-label="Filter by category"]')!.value === 'c1', 'category filter preserved');
  assert(product.fields.currentStock === 35 && product.fields.barcode === '00000123456', 'no stock or barcode changes');
  results.push('Successful update refreshes the existing row and preserves code, filters, stock and barcode');

  await open(); assert(input('product-name').value === 'Product Updated', 'reopened editor uses updated product');
  assert(input('product-taxIndex').value === '1', 'updated tax retained');
  mode = 'expired'; button('Update').click(); await waitFor(() => expired === 1, 'expired session');
  assert(JSON.stringify(patches.at(-1)!.body) === '{}', 'unchanged form submits no field replacements');
  results.push('Reopening reflects saved values; unchanged fields omitted; expired session handled');
  root.unmount(); document.getElementById('test-results')!.textContent = JSON.stringify({ passed: results });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), passed: results }); });
