import { createRoot } from 'react-dom/client';
import { GoodsReceivedPage } from '../src/pages/GoodsReceivedPage.tsx';
import type { OutletSummary } from '../src/pages/OutletSelectionPage.tsx';
import '../src/index.css';
import '../src/App.css';
import '../src/Theme.css';

const passed: string[] = [];
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const existingSupplier = { id: 'S'.repeat(20), name: 'Existing Supplier', mobile: '00000', address: '', alternateNumber: null, email: '', gstin: '' };
let storageWrites = 0, cancelled = false, loseResponse = true, saved = 0, reads = 0;
const posts: any[] = [], receipts: any[] = [], supplierPosts: any[] = [];
const supplierRecords = new Map<string, any>();
let loseSupplierResponse = true;
const products = [{ documentId: 'rice', fields: { name: 'Rice', code: 1, barcode: '100003', category: 'groceries', stockable: true, weighable: false, currentStock: 3, unitId: 0, costPrice: 0, price: 23 } },
  { documentId: 'tea', fields: { name: 'Tea', code: 2, category: 'beverages', stockable: true, weighable: false, currentStock: 7, unitId: 4, costPrice: 2, price: 10 } },
  { documentId: 'hidden', fields: { name: 'Untracked', stockable: false, currentStock: 10 } }];
Storage.prototype.setItem = () => { storageWrites++; throw new Error('No browser persistence'); };
window.fetch = async (url, init) => {
  const path = String(url);
  assert(new Headers(init?.headers).get('Authorization') === 'Bearer token', 'Authorization retained');
  if (path.endsWith('/products')) return Response.json({ success: true, data: products });
  if (path.endsWith('/categories')) return Response.json({ success: true, data: [{ id: 'groceries', name: 'Groceries' }, { id: 'beverages', name: 'Beverages' }] });
  if (path === '/api/outlets/outlet/suppliers') {
    assert(init?.method === 'POST', 'Supplier form uses POST');
    const payload = JSON.parse(String(init?.body)); supplierPosts.push(payload);
    assert(payload.documentId === 'D'.repeat(20), 'Supplier save retains allocated auto-ID');
    assert(typeof payload.fields.alternateNumber === 'string' && typeof payload.fields.mobile === 'string', 'Supplier numbers stay strings');
    const fields = { ...payload.fields, id: null };
    if (!supplierRecords.has(payload.documentId)) supplierRecords.set(payload.documentId, fields);
    if (loseSupplierResponse) { loseSupplierResponse = false; throw new Error('Supplier response lost after commit'); }
    return Response.json({ success: true, data: { documentId: payload.documentId, fields, nextDocumentId: 'E'.repeat(20) } });
  }
  assert(path === '/api/outlets/outlet/goods-received', 'Only authorized receipt/product reads and receipt writes');
  if (init?.method !== 'POST') {
    reads++;
    return Response.json({ success: true, data: { documentId: saved ? 'N'.repeat(20) : 'R'.repeat(20), supplierDraftId: 'D'.repeat(20), suppliers: [existingSupplier], receipts } });
  }
  const payload = JSON.parse(String(init.body)); posts.push(payload);
  assert(payload.documentId === 'R'.repeat(20) && payload.goodsReceivedNo === payload.documentId, 'Stable auto-ID also supplies the receipt number');
  if (!saved) { saved++; receipts.push({ documentId: payload.documentId, fields: { supplier: payload.supplier, goodsReceivedNo: payload.goodsReceivedNo, createDate: Date.now(), goodsReceivedItemBeanList: [{ name: 'Rice', quantity: payload.items[0].quantity }] } }); }
  if (loseResponse) { loseResponse = false; throw new Error('Response lost after commit'); }
  return Response.json({ success: true, data: { documentId: payload.documentId, alreadySaved: true } });
};
const root = createRoot(document.getElementById('root')!);
root.render(<div className="retail-dashboard-shell"><main className="dashboard-workspace" style={{ width: '100%', minWidth: 0 }}><GoodsReceivedPage outlet={{ id: 'outlet', name: 'Test Outlet' } as OutletSummary} token="token" onSessionExpired={() => { throw new Error('Unexpected expiry'); }} onCancel={() => { cancelled = true; }} /></main></div>);
const pause = () => new Promise(resolve => setTimeout(resolve, 25));
async function until(check: () => unknown, message: string) { for (let i = 0; i < 150; i++) { if (check()) return; await pause(); } throw new Error(`Timeout: ${message}`); }
const button = (text: string) => {
  const result = [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === text);
  if (!result) throw new Error(`Missing button: ${text}`); return result;
};
const labelled = (text: string) => {
  const label = [...document.querySelectorAll('label')].find(node => node.firstChild?.textContent?.trim() === text);
  const input = label?.querySelector('input, select'); assert(input, `Missing field: ${text}`); return input as HTMLInputElement | HTMLSelectElement;
};
async function setValue(element: HTMLInputElement | HTMLSelectElement, value: string) {
  const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
  element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); await pause();
}
void (async () => {
  await until(() => document.querySelector('[aria-label="Product categories"]'), 'outlet loaded');
  if (location.hash === '#preview') { document.getElementById('test-results')!.textContent = JSON.stringify({ passed: ['Goods Received layout'] }); return; }
  assert(posts.length === 0 && reads === 1, 'Opening reads data without writes');
  assert(!document.body.textContent?.includes('Receipt entry only') && !document.body.textContent?.includes('Goods Received Number') && !document.body.textContent?.includes('Search suppliers') && !document.body.textContent?.includes('Only the receipt record will be saved'), 'Requested notices and fields are removed');
  assert(!document.querySelector('.goods-receipt-panel, .goods-catalog-panel, details'), 'Split panels and catalog toggles removed');
  const table = document.querySelector('.goods-products-table')!;
  const searchField = document.querySelector('.goods-search-field')!;
  assert(!!(table.compareDocumentPosition(searchField) & Node.DOCUMENT_POSITION_FOLLOWING), 'Search is below the product list');
  assert(!!(document.querySelector('.goods-category-tabs')!.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING), 'Category tabs are above the product list');
  assert([...document.querySelectorAll('.goods-entry-footer button')].map(node => node.textContent?.trim()).join(',') === 'Cancel,Save', 'Footer has only Cancel and Save');
  assert(!document.body.textContent?.includes('Receipt items') && !document.querySelector('.goods-entry-values'), 'Separate receipt list and entry panel removed');
  assert(!document.body.textContent?.includes('Untracked'), 'Non-stockable products excluded');
  button('Save').click(); await pause(); assert(document.querySelector('[role="alert"]')?.textContent?.includes('supplier'), 'Supplier required');
  button('Add Supplier').click(); await pause();
  assert(document.querySelectorAll('.goods-supplier-form-grid input').length === 8, 'Supplier modal contains exactly the eight requested fields');
  for (const label of ['Name','Mobile','Short Name','Search Code','Alternate Numbers','Email','GST IN','Address']) assert(labelled(label), `Supplier field: ${label}`);
  for (const label of ['Short Name','Search Code']) assert(labelled(label).disabled, 'Unsupported supplier fields cannot be silently saved');
  await setValue(labelled('Name'), 'New Supplier'); await setValue(labelled('Mobile'), '99999');
  await setValue(labelled('Address'), 'Supplier address'); await setValue(labelled('GST IN'), 'GST123');
  await setValue(labelled('Alternate Numbers'), '123456');
  button('Save Supplier').click();
  await until(() => [...document.querySelectorAll('button')].some(node => node.textContent === 'Retry supplier save'), 'uncertain supplier save');
  assert(labelled('Name').matches(':disabled') && supplierRecords.size === 1 && posts.length === 0, 'Supplier saved independently and uncertain form is locked');
  button('Retry supplier save').click(); button('Retry supplier save').click();
  await until(() => !document.querySelector('.goods-supplier-dialog'), 'supplier confirmed');
  assert(supplierRecords.size === 1 && supplierPosts.length === 2 && JSON.stringify(supplierPosts[0]) === JSON.stringify(supplierPosts[1]), 'Supplier retries create one master only');
  assert(supplierRecords.get('D'.repeat(20)).id === null && supplierRecords.get('D'.repeat(20)).alternateNumber === '123456', 'Supplier master keeps id:null and alternateNumber:string');
  assert(posts.length === 0 && document.body.textContent?.includes('Supplier saved successfully'), 'Supplier success does not create a receipt');
  button('Groceries').click(); await pause(); assert(!document.querySelector('.goods-products-table')?.textContent?.includes('Tea'), 'Category tab filters');
  await setValue(labelled('Search products'), '100003');
  document.querySelector<HTMLButtonElement>('[aria-label="Select product Rice"]')!.click(); await pause();
  const qty = () => document.querySelector<HTMLInputElement>('[aria-label="Received quantity for Rice"]')!;
  assert(qty() && !qty().disabled, 'Selected product is editable directly in the unified list');
  button('All').click(); await pause();
  await setValue(labelled('Search products'), '');
  assert(document.querySelector<HTMLInputElement>('[aria-label="Include Rice"]')!.checked, 'Selection survives filtering');
  assert(document.querySelector<HTMLInputElement>('[aria-label="Received quantity for Tea"]')!.disabled, 'Unselected products are excluded from receipt edits');
  await setValue(qty(), '0'); button('Save').click(); await pause(); assert(posts.length === 0 && document.querySelector('[role="alert"]')?.textContent?.includes('positive'), 'Invalid quantity makes no write');
  await setValue(qty(), '58'); button('Save').click(); await pause(); assert(posts.length === 0 && document.querySelector('dialog[open]'), 'Review precedes write');
  button('Keep editing').click(); await pause(); assert(qty() && posts.length === 0, 'Cancelling confirmation retains draft and makes no write');
  button('Save').click(); await pause(); button('Confirm receipt').click();
  await until(() => [...document.querySelectorAll('button')].some(node => node.textContent === 'Retry confirmation'), 'uncertain save');
  assert(saved === 1 && labelled('Supplier').matches(':disabled'), 'Uncertain save locks form');
  assert(posts[0].supplier.id === 'D'.repeat(20) && posts[0].supplier.gstin === 'GST123' && posts[0].supplier.alternateNumber === null, 'Exact supplier map submitted');
  button('Retry confirmation').click(); button('Retry confirmation').click();
  await until(() => document.body.textContent?.includes('Goods receipt saved') && !document.body.textContent?.includes('Loading outlet'), 'save and refresh');
  assert(saved === 1 && posts.length === 2 && JSON.stringify(posts[0]) === JSON.stringify(posts[1]), 'Lost-response retry uses identical receipt once');
  assert(reads === 2 && !document.body.textContent?.includes('Saved receipts'), 'Receipt data refreshes without displaying saved receipts');
  assert(labelled('Supplier').value === '', 'Draft clears only after confirmed save');
  assert(products[0].fields.currentStock === 3 && storageWrites === 0, 'No product balance or browser storage changes');
  button('Cancel').click(); assert(cancelled, 'Cancel navigation retained');
  passed.push('authenticated reads, stockable product selection, supplier master save/retry and receipt snapshot, validation, confirmation cancellation, one receipt on retry, refresh without receipt history, no stock/storage writes');
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ passed, failed: String(error) }); });
