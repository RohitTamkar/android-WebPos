import { createRoot } from 'react-dom/client';
import { ProductsPage } from '../src/pages/ProductsPage.tsx';
import type { OutletSummary } from '../src/pages/OutletSelectionPage.tsx';
import '../src/index.css';

const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 30));
async function until(condition: () => unknown) {
  for (let i = 0; i < 150; i++) { if (condition()) return; await pause(); }
  throw new Error('Timed out waiting for UI');
}
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === label)!;
const row = { documentId: 'table', fields: { name: 'TABLE', code: 1, taxIndex: 9, userId: 'user', type: 'Table', tables: 1, range: 1, price: 50, extraPriceFlag: true } };
const patches: Record<string, unknown>[] = [];
let fail = true;
window.fetch = async (url, init) => {
  const path = String(url);
  assert(path.startsWith('/api/outlets/outlet/'), 'Requests use selected outlet');
  assert(new Headers(init?.headers).get('Authorization') === 'Bearer token', 'Requests authenticated');
  if (init?.method === 'PATCH') {
    assert(path.endsWith('/premises/table'), 'Update existing premise');
    const payload = JSON.parse(String(init.body)); patches.push(payload);
    if (fail) { fail = false; return Response.json({ message: 'Try again' }, { status: 503 }); }
    Object.assign(row.fields, payload);
    return Response.json({ data: row });
  }
  if (path.endsWith('/premises')) return Response.json({ data: { premises: [row], nextCode: 2, taxes: [], userAccounts: [{ userId: 'user', name: 'Team 101' }] } });
  return Response.json({ data: [] });
};
createRoot(document.getElementById('root')!).render(<ProductsPage outlet={{ id: 'outlet', name: 'Outlet' } as OutletSummary} token="token" onSessionExpired={() => { throw new Error('Unexpected expiration'); }} />);
void (async () => {
  await until(() => document.querySelector('[aria-label="More options"]'));
  document.querySelector<HTMLButtonElement>('[aria-label="More options"]')!.click();
  await until(() => button('Update premise price'));
  button('Update premise price').click();
  await until(() => document.querySelector('.premises-list-item'));
  assert(!button('Add New Premises'), 'Product flow offers premise selection');
  document.querySelector<HTMLButtonElement>('.premises-list-item')!.click();
  await until(() => button('Update'));
  for (const id of ['name', 'code', 'tax', 'user', 'tables', 'range']) assert(document.getElementById(`premise-${id}`), `${id} field displayed`);
  assert(document.querySelectorAll('[name="premise-type"]').length === 3, 'Table, Room and Bill selectable');
  assert(!document.getElementById('premise-price'), 'Form ends with range as requested');
  assert((document.getElementById('premise-tax') as HTMLSelectElement).value === '9', 'Saved GST selected');
  const name = document.getElementById('premise-name') as HTMLInputElement;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(name, 'New Table');
  name.dispatchEvent(new Event('input', { bubbles: true })); await pause();
  button('Update').click();
  await until(() => document.querySelector('[role="alert"]'));
  assert(name.value === 'New Table', 'Failed update retains edits');
  button('Update').click();
  await until(() => document.querySelector('.premises-notice'));
  assert(document.querySelector('.premises-list-item')?.textContent?.includes('New Table'), 'List displays saved name');
  assert(patches.length === 2 && JSON.stringify(patches[1]) === '{"name":"New Table"}', 'Only changed details saved, preserving price fields');
  button('Back to Products').click();
  await until(() => document.querySelector('[aria-label="More options"]'));
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed: ['Products menu opens premises list, saved edit fields, update failure and retry, price preservation, and return to Products'] });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error) }); });
