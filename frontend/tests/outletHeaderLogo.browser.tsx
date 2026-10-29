import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { OutletLogoPage } from '../src/pages/OutletLogoPage.tsx';
import App from '../src/App.tsx';
import '../src/index.css';
const checks: string[] = [];
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); checks.push(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 20));
async function until(check: () => unknown) { for (let i = 0; i < 250; i++) { if (check()) return; await pause(); } throw new Error('Timed out'); }
const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lS8AAAAASUVORK5CYII='), char => char.charCodeAt(0));
const store = new Map<string, { bytes: Blob; generation: string }>([
  ['Outlet A:header', { bytes: new Blob([bytes], { type: 'image/png' }), generation: '1' }],
  ['Outlet A:footer', { bytes: new Blob([bytes], { type: 'image/png' }), generation: '2' }],
  ['shop:header', { bytes: new Blob([bytes], { type: 'image/png' }), generation: '3' }],
]);
let nextVersion = 4, failNext = false, conflictNext = false;
const changes: string[] = [], requests: string[] = [];
const delayed = new Map<string, (response: Response) => void>();
window.fetch = async (input, init) => {
  const url = new URL(String(input), location.href);
  if (url.pathname.endsWith('/dashboard')) return Response.json({ success: true, data: { shifts: [], dayId: url.searchParams.get('dayId') } });
  if (url.pathname.endsWith('/profile')) return Response.json({ success: true, data: { name: 'Cashier', outletName: 'Outlet A', role: 'Admin' } });
  if (url.pathname === '/api/auth/outlets') return Response.json({ success: true, data: { outlets: [{ id: 'none', name: 'No Logo', active: true }] } });
  const id = decodeURIComponent(url.pathname.split('/')[3]!);
  assert(url.pathname === `/api/outlets/${encodeURIComponent(id)}/logo`, 'logo actions use only the selected outlet endpoint');
  const variant = url.searchParams.get('variant')!, key = `${id}:${variant}`, method = init?.method ?? 'GET';
  assert(['header', 'footer'].includes(variant), 'header/footer variant is explicit');
  assert(new Headers(init?.headers).get('authorization') === 'Bearer mock', 'existing authentication is preserved');
  requests.push(`${method}:${key}`);
  if (method === 'GET') {
    if (id === 'Slow') return new Promise<Response>(resolve => delayed.set(key, resolve));
    const item = store.get(key);
    return item ? new Response(item.bytes, { headers: { 'X-Logo-Generation': item.generation } }) : new Response('', { status: 404 });
  }
  const expected = new Headers(init?.headers).get('X-Logo-Expected-Generation');
  assert(expected !== null, 'mutations carry the reviewed Storage version');
  if (failNext) { failNext = false; throw new Error('Network unavailable'); }
  if (conflictNext) { conflictNext = false; return Response.json({ success: false, message: 'This logo changed elsewhere. Reload it before trying again.' }, { status: 409 }); }
  if (expected !== (store.get(key)?.generation ?? '0')) return Response.json({ success: false, message: 'Stale version' }, { status: 409 });
  if (method === 'PUT') {
    assert(init?.body instanceof Blob, 'upload sends actual image bytes');
    store.set(key, { bytes: init!.body as Blob, generation: String(nextVersion++) });
  } else if (method === 'DELETE') store.delete(key);
  else throw new Error('Unexpected mutation');
  changes.push(`${method}:${key}`); return Response.json({ success: true });
};
let root = createRoot(document.getElementById('root')!);
const render = (id: string) => flushSync(() => root.render(<OutletLogoPage outletId={id} outletName={id} token="mock" />));
const image = () => document.querySelector<HTMLImageElement>('.outlet-logo-preview img');
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === label)!;
const tab = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('[role=tab]')].find(node => node.textContent === label)!;
const chooseFile = (data: BlobPart = bytes, type = 'image/png') => {
  const input = document.querySelector<HTMLInputElement>('.outlet-logo-actions input')!;
  const transfer = new DataTransfer(); transfer.items.add(new File([data], 'logo.png', { type })); input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
};
const settled = async () => until(() => !document.querySelector('[role=tabpanel][aria-busy=true]'));
void (async () => {
  render('Outlet A'); await until(() => image()?.alt === 'Outlet A Header Logo');
  assert(tab('Header Logo').getAttribute('aria-selected') === 'true' && !!tab('Footer Logo'), 'Header Logo and Footer Logo tabs match the requested layout');
  const preview = document.querySelector('.outlet-logo-preview')!.getBoundingClientRect(), picture = image()!.getBoundingClientRect();
  assert(Math.abs((picture.left + picture.right) / 2 - (preview.left + preview.right) / 2) <= 1 && Math.abs((picture.top + picture.bottom) / 2 - (preview.top + preview.bottom) / 2) <= 1, 'logo is centered horizontally and vertically');
  assert(changes.length === 0, 'opening the logo screen performs no mutations');
  tab('Footer Logo').click(); await until(() => image()?.alt === 'Outlet A Footer Logo');
  assert(changes.length === 0 && !!button('Upload Footer Logo'), 'selecting Footer Logo is read-only and changes the upload target');
  chooseFile(); chooseFile(); await until(() => !!document.querySelector('.logo-success')); await settled();
  assert(changes.length === 1 && changes[0] === 'PUT:Outlet A:footer', 'upload works once despite duplicate selections and changes only the selected footer');
  assert(store.get('Outlet A:header')!.generation === '1' && image()?.alt === 'Outlet A Footer Logo', 'header logo is preserved and footer preview refreshes after upload');
  failNext = true; button('Remove').click();
  await until(() => document.querySelector('[role=alert]')?.textContent?.includes('Network')); await settled();
  assert(changes.length === 1 && !!image(), 'failed footer removal preserves the saved logo and reports the error');
  assert(!document.querySelector('dialog[open]'), 'failed removal does not show a success popup');
  tab('Header Logo').click(); await until(() => image()?.alt === 'Outlet A Header Logo');
  conflictNext = true; button('Remove').click();
  await until(() => document.querySelector('[role=alert]')?.textContent?.includes('changed elsewhere')); await settled();
  assert(changes.length === 1 && !!image(), 'conflicting header removal reloads the saved logo without retrying');
  tab('Footer Logo').click(); await until(() => image()?.alt === 'Outlet A Footer Logo');
  chooseFile('invalid data'); await until(() => document.querySelector('[role=alert]')?.textContent?.includes('readable image'));
  assert(changes.length === 1, 'invalid image bytes are rejected before any mutation request');
  chooseFile(bytes, 'text/plain'); await until(() => document.querySelector('[role=alert]')?.textContent?.includes('5 MB'));
  assert(changes.length === 1, 'unsupported file types never reach Storage');
  failNext = true; chooseFile(); await until(() => document.querySelector('[role=alert]')?.textContent?.includes('Network')); await settled();
  assert(changes.length === 1 && !!image(), 'network failures do not report success or lose the saved preview');
  conflictNext = true; chooseFile(); await until(() => document.querySelector('[role=alert]')?.textContent?.includes('changed elsewhere')); await settled();
  assert(changes.length === 1 && !!image(), 'concurrent changes are reported and reloaded without automatic overwrite');
  button('Remove').click(); button('Remove').click();
  await until(() => document.querySelector('[role=status]')?.textContent?.includes('removed successfully')); await settled();
  assert(changes.length === 2 && changes[1] === 'DELETE:Outlet A:footer' && !image() && button('Remove').disabled, 'duplicate removal clicks delete only the selected footer once and clear the preview');
  assert(store.has('Outlet A:header') && !store.has('Outlet A:footer'), 'footer removal preserves the header');
  await until(() => document.querySelector('dialog[open]')?.textContent?.includes('Footer Logo removed successfully.'));
  button('OK').click(); await until(() => !document.querySelector('dialog[open]'));
  assert(!document.querySelector('dialog[open]'), 'footer removal success popup closes with OK');
  tab('Header Logo').click(); await until(() => image()?.alt === 'Outlet A Header Logo'); await settled();
  button('Remove').click(); await until(() => changes.length === 3); await settled();
  assert(changes[2] === 'DELETE:Outlet A:header' && !image() && button('Remove').disabled, 'header removal clears the saved header and disables further removal');
  await until(() => document.querySelector('dialog[open]')?.textContent?.includes('Header Logo removed successfully.'));
  button('OK').click(); await until(() => !document.querySelector('dialog[open]'));
  assert(!document.querySelector('dialog[open]'), 'header removal success popup closes with OK');
  tab('Footer Logo').click(); await until(() => tab('Footer Logo').getAttribute('aria-selected') === 'true'); await settled();
  assert(!image(), 'removed footer stays absent after returning to the tab');
  render('Other'); await settled(); render('Outlet A'); await settled();
  assert(!image() && !button('Upload Header Logo').disabled, 'removed header stays absent after remounting and can be uploaded again');
  chooseFile(); await until(() => changes.length === 4); await settled();
  assert(!!image(), 'upload works after removing a logo');
  render('Slow'); await until(() => delayed.has('Slow:header')); render('Outlet A'); await until(() => image()?.alt === 'Outlet A Header Logo');
  delayed.get('Slow:header')!(new Response(new Blob([bytes], { type: 'image/png' }), { headers: { 'X-Logo-Generation': '1' } }));
  await pause(); assert(image()?.alt === 'Outlet A Header Logo', 'late responses cannot show another outlet logo');
  render('Missing'); await settled();
  assert(!image() && !!button('Remove') && !button('Upload Header Logo').disabled, 'missing logo shows a blank preview with working upload');
  chooseFile(); await until(() => changes.length === 5); await settled(); assert(image()?.alt === 'Missing Header Logo', 'first header upload creates and displays the new logo');
  root.unmount(); const before = requests.length;
  localStorage.clear(); history.replaceState(null, '');
  localStorage.setItem('pos_user_session', JSON.stringify({ id: 'signed', name: 'Cashier', email: 'user@example.com', role: 'Admin', terminal: 'POS', token: 'mock' }));
  localStorage.setItem('pos_selected_outlet', JSON.stringify({ id: 'shop', name: 'Outlet A', active: true }));
  root = createRoot(document.getElementById('root')!); root.render(<App />); await until(() => document.querySelector('.page-hero'));
  const headerLogo = () => document.querySelector<HTMLImageElement>('.retail-header .header-logo-crop img')!;
  assert(headerLogo().getAttribute('src') === '/logo1.png' && requests.length === before, 'application header keeps Sensible Connect branding and does not load outlet logos');
  [...document.querySelectorAll<HTMLButtonElement>('.nav-group-items button')].find(node => node.textContent === 'Logo')!.click(); await until(() => image()?.alt === 'Outlet A Header Logo');
  assert([...document.querySelectorAll<HTMLButtonElement>('.nav-group-items button')].find(node => node.textContent === 'Logo')!.closest('.nav-group')?.querySelector('.nav-group-title')?.textContent?.includes('Masters'), 'Logo appears under Masters with title case');
  assert(![...document.querySelectorAll('.nav-group-items button')].some(node => node.textContent === 'LOGO'), 'old Operations LOGO entry is removed');
  assert(headerLogo().getAttribute('src') === '/logo1.png', 'Logo navigation and management preserve the application header');
  assert([...document.querySelectorAll('.outlet-logo-actions button')].every(node => { const rect = node.getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth; }), 'upload and remove controls fit the viewport');
  root.unmount(); document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, checks });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), checks }); });
