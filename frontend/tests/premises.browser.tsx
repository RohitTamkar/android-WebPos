import { createRoot } from 'react-dom/client';
import { PremisesPage } from '../src/pages/PremisesPage.tsx';
import type { OutletSummary } from '../src/pages/OutletSelectionPage.tsx';
import '../src/index.css';
import '../src/App.css';
import '../src/Theme.css';

const passed: string[] = [];
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 30));
const until = async (condition: () => unknown, message: string) => {
  for (let index = 0; index < 150; index++) { if (condition()) return; await pause(); }
  throw new Error(`Timed out: ${message}`);
};
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === label)!;
const writes: Record<string, unknown>[] = [];
const premises: { documentId: string; fields: Record<string, unknown> }[] = [{ documentId: 'original', fields: { code: 1, name: 'TABLE', type: 'Table', tables: 1, range: 1,
  taxIndex: 2, userId: 'account', price: 0, extraPriceFlag: false, id: null, createdTime: 'saved timestamp', custom: 'keep' } }];
let saved: { documentId: string; fields: any } | undefined;
let releaseInitial!: () => void;
const initial = new Promise<void>(resolve => { releaseInitial = resolve; });
const patches: Record<string, unknown>[] = [];
let failPatch = true;
window.fetch = async (url, init) => {
  assert(String(url).startsWith('/api/outlets/outlet/premises'), 'Premises API is scoped to selected outlet');
  assert(new Headers(init?.headers).get('Authorization') === 'Bearer token', 'Authenticated requests');
  if (init?.method === 'PATCH') {
    assert(String(url).endsWith('/original'), 'Update targets the existing document');
    const body = JSON.parse(String(init.body)); patches.push(body);
    await new Promise(resolve => setTimeout(resolve, 80));
    if (failPatch) { failPatch = false; return Response.json({ message: 'Update failed. Retry.' }, { status: 503 }); }
    const row = premises[0]!; row.fields = { ...row.fields, ...body };
    return Response.json({ data: row });
  }
  if (init?.method !== 'POST') {
    await initial;
    return Response.json({ data: { premises, nextCode: 2,
      taxes: [], userAccounts: [{ userId: 'account', name: 'Software developer | Team 101' }] } });
  }
  const body = JSON.parse(String(init.body)); writes.push(body);
  if (!saved) {
    saved = { documentId: 'new', fields: { ...body, id: null } }; premises.push(saved);
    throw new Error('Lost response. Retry the same form.');
  }
  assert(body.requestId === writes[0]!.requestId, 'Retry retains request ID');
  return Response.json({ data: saved });
};
const root = createRoot(document.getElementById('root')!);
root.render(<PremisesPage outlet={{ id: 'outlet', name: 'Test Outlet' } as OutletSummary} token="token" onSessionExpired={() => { throw new Error('Unexpected expiration'); }} />);
async function value(id: string, next: string) {
  const element = document.getElementById(id) as HTMLInputElement | HTMLSelectElement;
  const prototype = element.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, next);
  element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  await pause();
}
void (async () => {
  await until(() => button('Add New Premises'), 'Premises header');
  assert(!button('Add New Premises').disabled, 'Add is available while the list loads');
  button('Add New Premises').click(); await until(() => document.getElementById('premise-name'), 'Form opens during loading');
  await value('premise-name', 'Draft while loading');
  assert(button('Create Premises').disabled, 'Save waits for the next code and assigned account');
  releaseInitial(); await until(() => !button('Create Premises').disabled, 'Options ready');
  assert((document.getElementById('premise-name') as HTMLInputElement).value === 'Draft while loading', 'Loading keeps typed values');
  assert((document.getElementById('premise-code') as HTMLInputElement).value === '2', 'Loading fills safe next code');
  passed.push('Add Premises opens during list loading and retains typed details when options arrive');
  button('Cancel').click();
  await until(() => document.querySelector('.premises-list-item'), 'Existing premises');
  assert(document.querySelector('.premises-list')?.textContent?.includes('TABLE'), 'Saved premises are listed');
  passed.push('Existing premises list loads with code, name, type, count and range');
  button('Add New Premises').click(); await until(() => document.getElementById('premise-name'), 'Creation form');
  assert((document.getElementById('premise-code') as HTMLInputElement).value === '2', 'Next code defaults correctly');
  assert((document.getElementById('premise-tax') as HTMLSelectElement).value === '1', 'New premises default to Android GST 0 ID 1');
  const taxOptions = [...document.querySelectorAll<HTMLOptionElement>('#premise-tax option')].filter(option => option.value);
  assert(taxOptions.length === 12 && taxOptions[5]!.textContent === 'VAT 22' && taxOptions[5]!.value === '6', 'All twelve Android GST/VAT options display without TAX_MASTER configuration');
  await value('premise-tax', '2');
  assert((document.getElementById('premise-user') as HTMLSelectElement).value === 'account', 'Assigned user selected');
  assert(document.querySelectorAll('input[type=radio]').length === 3, 'All three premise types available');
  await value('premise-name', 'AC ROOM');
  (document.querySelectorAll<HTMLInputElement>('input[type=radio]')[1])!.click(); await pause();
  await value('premise-tables', '3'); await value('premise-range', '11');
  button('Create Premises').click(); await until(() => document.querySelector('[role=alert]'), 'Lost response');
  assert(document.getElementById('premise-name'), 'Failed save keeps form');
  button('Create Premises').click(); await until(() => document.querySelector('.premises-notice'), 'Save retry');
  assert(writes.length === 2 && document.querySelectorAll('.premises-list-item').length === 2, 'Retry creates one new list row');
  for (const key of ['code', 'tables', 'range', 'taxIndex', 'price']) assert(typeof writes[0]![key] === 'number', `${key} submitted as number`);
  assert(writes[0]!.type === 'Room' && writes[0]!.extraPriceFlag === false && writes[0]!.price === 0, 'Exact type, boolean and zero price');
  passed.push('Create form preserves numeric/boolean values, tax index, assigned account and Room type');
  passed.push('Lost response retries use the same ID and insert one row');
  button('Add New Premises').click(); await until(() => document.getElementById('premise-code'), 'Second form');
  assert((document.getElementById('premise-code') as HTMLInputElement).value === '3', 'Next code advances');
  button('Cancel').click(); await pause();
  const search = document.querySelector<HTMLInputElement>('[aria-label="Search premises"]')!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'AC ROOM');
  search.dispatchEvent(new Event('input', { bubbles: true })); await pause();
  assert(document.querySelectorAll('.premises-list-item').length === 1, 'Search filters list');
  passed.push('Next code advances, cancel makes no writes, and search filters premises');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, '');
  search.dispatchEvent(new Event('input', { bubbles: true })); await pause();
  document.querySelector<HTMLButtonElement>('[aria-label="Edit premise TABLE"]')!.click();
  await until(() => button('Update'), 'Click opens existing premise');
  assert((document.getElementById('premise-name') as HTMLInputElement).value === 'TABLE', 'Saved name loaded');
  assert((document.getElementById('premise-tax') as HTMLSelectElement).value === '2', 'Saved GST index loaded');
  await value('premise-name', 'Discard'); button('Cancel').click(); await pause();
  assert(patches.length === 0, 'Cancel does not update');
  document.querySelector<HTMLButtonElement>('[aria-label="Edit premise TABLE"]')!.click(); await until(() => button('Update'), 'Reopen existing premise');
  await value('premise-name', 'TABLE Updated'); await value('premise-price', '25'); await value('premise-tax', '6');
  button('Update').click(); button('Update').click();
  await until(() => document.querySelector('[role=alert]')?.textContent?.includes('Update failed'), 'Failed update');
  assert(patches.length === 1, 'Repeated clicks submit one update');
  assert((document.getElementById('premise-name') as HTMLInputElement).value === 'TABLE Updated', 'Failure retains edits');
  assert(JSON.stringify(patches[0]) === JSON.stringify({ name: 'TABLE Updated', taxIndex: 6, price: 25 }), 'Only changed editable fields sent with numeric VAT index');
  button('Update').click(); await until(() => document.querySelector('.premises-notice')?.textContent?.includes('updated'), 'Update success');
  assert(premises.length === 2 && document.querySelectorAll('.premises-list-item').length === 2, 'Update does not create a new premise');
  assert(premises[0]!.fields.id === null && premises[0]!.fields.createdTime === 'saved timestamp' && premises[0]!.fields.custom === 'keep', 'Metadata unchanged');
  document.querySelector<HTMLButtonElement>('[aria-label="Edit premise TABLE Updated"]')!.click(); await until(() => button('Update'), 'Reopen updated record');
  assert((document.getElementById('premise-tax') as HTMLSelectElement).value === '6', 'Saved VAT selection retained');
  button('Update').click(); await until(() => document.querySelector('.premises-notice')?.textContent?.includes('updated'), 'Unchanged update');
  assert(JSON.stringify(patches.at(-1)) === '{}', 'Unchanged form sends no replacement fields');
  passed.push('Clicking a premise opens saved details; Cancel is local and updates preserve identity, metadata and VAT IDs');
  passed.push('Update failures retain edits, duplicate clicks submit once, and unchanged fields are omitted');
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), passed }); });
