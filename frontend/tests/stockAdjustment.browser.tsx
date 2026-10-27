import { createRoot } from 'react-dom/client';
import { StockAdjustmentPage } from '../src/pages/StockAdjustmentPage.tsx';
import type { OutletSummary } from '../src/pages/OutletSelectionPage.tsx';
import '../src/index.css';
import '../src/App.css';
import '../src/Theme.css';

const passed: string[] = [];
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
let stock = 10;
const writes: { requestId: string; direction: string; items: { quantity: number; expectedStock: number; remark: string }[] }[] = [];
const committed = new Set<string>();
let loseResponse = true;
window.fetch = async (url, init) => {
  const path = String(url);
  assert(new Headers(init?.headers).get('Authorization') === 'Bearer token', 'Requests retain authorization');
  if (path.endsWith('/products')) return Response.json({ success: true, data: [
    { documentId: 'p1', fields: { code: 15, name: 'Tea', currentStock: stock, stockable: true } },
    { documentId: 'hidden', fields: { name: 'Not stockable', currentStock: 500, stockable: false } },
    { documentId: 'missing', fields: { name: 'Missing stockable flag', currentStock: 20 } },
    { documentId: 'string-flag', fields: { name: 'String flag', currentStock: 20, stockable: 'true' } },
    { documentId: 'p2', fields: { code: 20, name: 'Coffee', currentStock: 3, stockable: true } },
  ] });
  if (path.includes('/reports/stock-movements?')) return Response.json({ success: true, data: { movements: [{ items: [{ remark: 'Damaged' }] }] } });
  if (path.endsWith('/stock-adjustments')) {
    assert(init?.method === 'POST', 'Stock changes use POST');
    const body = JSON.parse(String(init.body)); writes.push(body);
    await new Promise(resolve => setTimeout(resolve, 60));
    if (!committed.has(body.requestId)) {
      assert(body.items[0].expectedStock === stock, 'Confirmation includes displayed stock');
      stock += body.direction === 'in' ? body.items[0].quantity : -body.items[0].quantity;
      committed.add(body.requestId);
      if (loseResponse) { loseResponse = false; throw new Error('Lost response after saving'); }
    }
    assert(/^[A-Za-z0-9]{20}$/.test(body.requestId), 'Stock confirmations use an auto-ID-format document ID');
    return Response.json({ success: true, data: { documentId: body.requestId } });
  }
  throw new Error(`Unexpected request: ${path}`);
};
const root = createRoot(document.getElementById('root')!);
root.render(<StockAdjustmentPage outlet={{ id: 'outlet', name: 'Test Outlet' } as OutletSummary} token="token" onSessionExpired={() => { throw new Error('Unexpected expiry'); }} />);
const pause = () => new Promise(resolve => setTimeout(resolve, 20));
async function until(check: () => unknown, message: string) { for (let i = 0; i < 120; i++) { if (check()) return; await pause(); } throw new Error(`Timeout: ${message}`); }
const button = (text: string) => {
  const found = [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === text);
  if (!found) throw new Error(`Button not found: ${text}`);
  return found;
};
async function inputValue(selector: string, value: string) {
  const element = document.querySelector<HTMLInputElement | HTMLSelectElement>(selector)!;
  const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
  element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); await pause();
}
void (async () => {
  await until(() => document.querySelector('[aria-label="Go ahead with Stock In"]'), 'stock choices');
  if (location.hash === '#preview') {
    document.documentElement.dataset.theme = 'light';
    document.body.style.background = 'var(--workspace)';
    document.body.style.padding = '24px';
    document.querySelector<HTMLButtonElement>('[aria-label="Go ahead with Stock In"]')!.click();
    await until(() => document.querySelector('select option[value="p1"]'), 'stock entry preview');
    document.getElementById('test-results')!.textContent = JSON.stringify({ passed: ['Stock In layout preview'] });
    return;
  }
  assert(writes.length === 0, 'Opening makes no writes');
  document.querySelector<HTMLButtonElement>('[aria-label="Go ahead with Stock In"]')!.click();
  await until(() => document.querySelector('select option[value="p1"]'), 'products');
  assert(!document.querySelector('.stock-direction-badge, .stock-entry-summary'), 'Stock In badges and totals are removed');
  assert(!document.querySelector('select option[value="hidden"], select option[value="missing"], select option[value="string-flag"]'), 'Only boolean stockable products are selectable');
  assert(!document.querySelector('[aria-label="Add selected product"]'), 'Separate add-product button is removed');
  await inputValue('[aria-label="Select product"]', 'p1');
  await until(() => document.querySelector('[aria-label="Quantity for Tea"]'), 'stock entry row');
  await inputValue('[aria-label="Quantity for Tea"]', '2.5');
  assert(document.querySelector('tbody')?.textContent?.includes('10'), 'Current stock is shown');
  assert(!document.querySelector('select option[value="p1"]'), 'Duplicate products are excluded');
  button('Add Stock').click(); await until(() => document.querySelector('dialog[open]'), 'confirmation');
  assert(writes.length === 0, 'Review does not write');
  button('Confirm stock changes').click(); button('Confirm stock changes').click();
  await until(() => [...document.querySelectorAll('button')].some(node => node.textContent === 'Retry confirmation'), 'uncertain save retry');
  assert(writes.length === 1 && stock === 12.5, 'Duplicate clicks are guarded and lost response is retained');
  assert(document.querySelector<HTMLButtonElement>('dialog button')!.disabled, 'Uncertain save cannot be abandoned as unsaved');
  button('Retry confirmation').click();
  await until(() => document.querySelector('dialog[open]')?.textContent?.includes('Stock added successfully'), 'reconciled save');
  assert(!document.body.textContent!.includes('Reference:'), 'No internal reference shown');
  button('OK').click(); await until(() => !document.querySelector('dialog[open]'), 'success dismissed');
  assert(writes.length === 2 && writes[0]!.requestId === writes[1]!.requestId && stock === 12.5, 'Retry uses the same request and does not apply stock twice');
  passed.push('Stock In choices, product rows, fractional quantities, explicit confirmation and safe lost-response retry');
  button('Back').click(); await pause();
  document.querySelector<HTMLButtonElement>('[aria-label="Go ahead with Stock Out"]')!.click();
  await until(() => document.querySelector('#stock-remark-options option'), 'existing remark suggestions');
  assert(!document.querySelector('.stock-direction-badge, .stock-entry-summary'), 'Stock Out badges and totals are removed');
  assert(!document.querySelector('select option[value="hidden"], select option[value="missing"], select option[value="string-flag"]'), 'Only boolean stockable products are selectable');
  await inputValue('[aria-label="Select product"]', 'p1');
  await until(() => document.querySelector('[aria-label="Quantity for Tea"]'), 'stock out row');
  assert(button('Remove Stock').disabled, 'Stock Out adds immediately but still requires a remark before saving');
  await inputValue('[aria-label="Remark for Tea"]', 'Damaged');
  await inputValue('[aria-label="Quantity for Tea"]', '20'); assert(button('Remove Stock').disabled, 'Insufficient stock cannot be submitted');
  await inputValue('[aria-label="Quantity for Tea"]', '2');
  button('Remove Stock').click(); await until(() => document.querySelector('dialog[open]'), 'stock out review');
  button('Cancel').click(); await pause(); assert(writes.length === 2, 'Cancel does not save');
  button('Remove Stock').click(); await until(() => document.querySelector('dialog[open]'), 'second stock out review');
  button('Confirm stock changes').click();
  await until(() => document.querySelector('dialog[open]')?.textContent?.includes('Stock removed successfully'), 'stock out saved');
  button('OK').click(); await until(() => !document.querySelector('dialog[open]'), 'stock out success dismissed');
  assert(stock === 10.5 && writes[2]!.items[0]!.remark === 'Damaged', 'Stock out sends its remark and subtracts quantity');
  passed.push('Stock Out uses existing remark suggestions, rejects insufficient stock, and saves only after confirmation');
  await until(() => document.querySelector('select option[value="p2"]'), 'refreshed products');
  await inputValue('[aria-label="Select remark"]', 'Damaged');
  await inputValue('[aria-label="Select product"]', 'p2');
  await until(() => document.querySelector('[aria-label="Remove Coffee"]'), 'added draft row');
  assert(document.querySelector<HTMLInputElement>('[aria-label="Remark for Coffee"]')!.value === 'Damaged', 'A preselected remark is copied to the new stock-out row');
  document.querySelector<HTMLButtonElement>('[aria-label="Remove Coffee"]')!.click(); await pause();
  assert(button('Remove Stock').disabled && writes.length === 3, 'Deleting a draft row does not change saved stock');
  passed.push('Removing a draft row is local; selected outlet data is refreshed after successful saves');
  root.unmount(); document.getElementById('test-results')!.textContent = JSON.stringify({ passed });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), passed }); });
