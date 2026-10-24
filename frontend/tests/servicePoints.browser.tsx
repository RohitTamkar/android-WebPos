import { createRoot } from 'react-dom/client';
import App from '../src/App.tsx';
import '../src/index.css';

localStorage.clear(); sessionStorage.clear();
localStorage.setItem('pos_user_session', JSON.stringify({ id: 'signed', name: 'User', email: 'user@example.com', role: 'Admin', terminal: 'POS', token: 'mock-token' }));
localStorage.setItem('pos_selected_outlet', JSON.stringify({ id: 'shop', name: 'Existing Shop' }));
const checks: string[] = [];
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); checks.push(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 25));
const until = async (check: () => unknown, message: string) => { for (let i = 0; i < 160; i++) { if (check()) return; await pause(); } throw new Error(`Timeout: ${message}`); };
const posts: Record<string, unknown>[] = [];
const patches: Record<string, unknown>[] = [];
const deletes: string[] = [];
let deleteStatus = 503;
let patchStatus = 503;
let postStatus = 503, getStatus = 200, release: (() => void) | undefined;
const savedRows = [{ documentId: 'existing', name: 'KOTPRINTER', paperSize: 3, printerType: 1, header: '', subHeader: '', footer: '', printerIpAddress: '', port: 9100, usbPath: null }];
window.fetch = async (url, init) => {
  const path = String(url);
  if (path.includes('/dashboard?')) return Response.json({ data: { payments: {}, shifts: [] } });
  assert(path === '/api/outlets/shop/service-points' || path === '/api/outlets/shop/service-points/saved', 'Service Point requests use the selected outlet');
  assert(new Headers(init?.headers).get('Authorization') === 'Bearer mock-token', 'Requests retain JWT authentication');
  if (init?.method === 'DELETE') {
    deletes.push(path);
    await new Promise<void>(resolve => { release = resolve; });
    if (deleteStatus !== 200) return Response.json({ success: false, message: 'Unable to confirm deletion. Please retry.' }, { status: deleteStatus });
    savedRows.splice(savedRows.findIndex(row => row.documentId === 'saved'), 1);
    return Response.json({ success: true, data: { documentId: 'saved' } });
  }
  if (init?.method === 'PATCH') {
    const body = JSON.parse(String(init.body)); patches.push(body);
    await new Promise<void>(resolve => { release = resolve; });
    if (patchStatus !== 200) return Response.json({ success: false, message: 'Update failed. Retry.' }, { status: patchStatus });
    const index = savedRows.findIndex(row => row.documentId === 'saved');
    savedRows[index] = { ...savedRows[index]!, ...body };
    return Response.json({ success: true, data: savedRows[index] });
  }
  if (init?.method === 'POST') {
    const body = JSON.parse(String(init.body)); posts.push(body);
    await new Promise<void>(resolve => { release = resolve; });
    if (postStatus !== 200) return Response.json({ success: false, message: 'Save failed. Please retry.' }, { status: postStatus });
    const { requestId: _id, ...fields } = body;
    const saved = { ...fields, documentId: 'saved' } as typeof savedRows[number]; savedRows.push(saved);
    return Response.json({ success: true, data: saved });
  }
  assert(init?.cache === 'no-store', 'List loads fresh database records');
  return Response.json(getStatus === 200 ? { success: true, data: { servicePoints: savedRows } } : { success: false, message: 'Unable to load service points.' }, { status: getStatus });
};
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === text)!;
const field = (name: string) => document.getElementById(`service-point-${name}`) as HTMLInputElement;
const edit = async (name: string, value: string) => {
  const node = field(name), prototype = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(node, value);
  node.dispatchEvent(new Event('input', { bubbles: true })); await pause();
};
const click = async (node: HTMLElement) => { node.click(); await pause(); };
const radio = (name: string, value: number) => document.querySelector<HTMLInputElement>(`input[name="${name}"][value="${value}"]`)!;
const root = createRoot(document.getElementById('root')!); root.render(<App />);
void (async () => {
  await until(() => button('Service Point'), 'Masters navigation');
  assert(button('Service Point').closest('.masters-group'), 'Service Point appears under Masters');
  await click(button('Service Point'));
  await until(() => document.querySelector('.service-points-table'), 'service point list');
  assert(document.querySelector('.service-points-table')?.textContent?.includes('KOTPRINTER'), 'Existing service points appear in list');
  await click(button('Add Service Point'));
  assert(field('name') && field('header') && field('subHeader') && field('footer'), 'Form contains name, header, sub header and footer');
  assert(radio('paperSize', 2).checked && radio('printerType', 0).checked && radio('paperSize', 3) && radio('printerType', 1) && radio('printerType', 2), 'Paper sizes and printer type options match the reference');
  const bounds = document.querySelector('.service-point-form-page')!.getBoundingClientRect();
  assert(bounds.left >= 0 && bounds.right <= innerWidth && !document.querySelector('dialog'), 'Form fits desktop/mobile workspace');
  await click(button('Cancel'));
  assert(!field('name') && posts.length === 0, 'Cancel returns to list without saving');
  await click(button('Add Service Point'));
  await edit('name', 'New Kitchen'); await edit('header', 'Kitchen Header'); await edit('subHeader', 'Sub Header'); await edit('footer', 'Thank you');
  if (location.hash === '#preview') { document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks }); return; }
  await click(radio('printerType', 2)); assert(field('usb'), 'USB connection detail is available');
  await click(radio('printerType', 1)); await click(radio('paperSize', 3));
  await edit('ip', '192.168.1.10'); await edit('port', '9100');
  await click(button('Save')); await until(() => release, 'pending save');
  assert(button('Saving…').disabled && button('Cancel').disabled && field('name').matches(':disabled'), 'Saving prevents duplicate submissions and edits');
  assert(!document.querySelector('.service-point-notice'), 'No success before server confirmation');
  release!(); await until(() => document.querySelector('[role="alert"]'), 'save failure');
  assert(field('name').value === 'New Kitchen' && !button('Save').disabled, 'Failed save retains the form and permits retry');
  const requestId = posts[0]!.requestId; postStatus = 200; release = undefined;
  await click(button('Save')); await until(() => release, 'retry pending'); release!();
  await until(() => document.querySelector('.service-point-notice'), 'save confirmation');
  assert(document.querySelector('.service-point-notice')?.textContent === 'Service point saved successfully.', 'Confirmed save shows success message');
  assert(!field('name') && document.querySelector('.service-points-table')?.textContent?.includes('New Kitchen'), 'Saved service point appears immediately in list');
  assert(posts.length === 2 && posts[1]!.requestId === requestId, 'Retry keeps the original idempotency key');
  assert(posts[1]!.paperSize === 3 && posts[1]!.printerType === 1 && posts[1]!.port === 9100 && posts[1]!.header === 'Kitchen Header', 'Form submits numeric printer settings and requested text fields');
  await click(button('New Kitchen'));
  assert(document.getElementById('service-point-title')?.textContent === 'Edit Service Point' && field('name').value === 'New Kitchen' && field('header').value === 'Kitchen Header' && radio('paperSize',3).checked && radio('printerType',1).checked, 'Clicking a service point opens its saved details');
  await click(button('Cancel')); assert(patches.length === 0, 'Cancel editing sends no update');
  await click(button('New Kitchen')); await edit('header','Updated Header'); release=undefined;
  await click(button('Update')); await until(()=>release,'update pending'); release!();
  await until(()=>document.querySelector('[role="alert"]'),'update failure');
  assert(field('header').value === 'Updated Header' && button('Update'), 'Update failure keeps edits for retry');
  patchStatus=200; release=undefined; await click(button('Update')); await until(()=>release,'update retry'); release!();
  await until(()=>document.querySelector('.service-point-notice')?.textContent === 'Service point updated successfully.','update success');
  assert(JSON.stringify(patches) === JSON.stringify([{header:'Updated Header'},{header:'Updated Header'}]), 'Updates send only changed settings to the existing record');
  assert(document.querySelector('.service-points-table')?.textContent?.includes('Updated Header') && savedRows.length===2,'Updated details appear in list without creating duplicates');
  // Remount the same App and reload the list from the mock database.
  getStatus = 503; root.render(<App key="reload" />);
  await until(() => document.querySelector('.dashboard-columns'), 'remounted dashboard');
  await click(button('Service Point')); await until(() => button('Retry'), 'list failure');
  getStatus = 200; await click(button('Retry')); await until(() => document.querySelector('.service-points-table'), 'list retry');
  assert(document.querySelector('.service-points-table')?.textContent?.includes('New Kitchen'), 'List retry reloads the persisted record');
  const deleteButton = () => document.querySelector<HTMLButtonElement>('[aria-label="Delete service point New Kitchen"]')!;
  await click(deleteButton());
  assert(document.querySelector('dialog[open]') && !field('name'), 'Delete opens confirmation without opening the editor');
  assert(document.querySelector('dialog')?.textContent?.includes('removed from all assigned products'), 'Confirmation explains automatic removal from products');
  await click(button('Cancel'));
  assert(deletes.length === 0 && !document.querySelector('dialog'), 'Cancel deletion sends no request');
  await click(deleteButton()); release = undefined;
  await click(document.querySelector<HTMLButtonElement>('.delete-confirmation-confirm')!);
  await until(() => release, 'delete pending');
  assert(button('Deleting…').disabled && button('Cancel').disabled, 'Pending deletion prevents duplicate requests and cancellation');
  assert(savedRows.length === 2 && !document.querySelector('.service-point-notice'), 'Row retained until deletion is confirmed');
  release!(); await until(() => document.querySelector('dialog [role="alert"]'), 'deletion failure');
  assert(document.querySelector('dialog [role="alert"]')?.textContent?.includes('retry') && savedRows.length === 2, 'Deletion failure is shown and row remains for retry');
  deleteStatus = 200; release = undefined;
  await click(document.querySelector<HTMLButtonElement>('.delete-confirmation-confirm')!);
  await until(() => release, 'delete retry'); release!();
  await until(() => document.querySelector('.service-point-notice')?.textContent === 'Service point deleted successfully.', 'delete success');
  assert(!deleteButton() && savedRows.length === 1 && document.querySelector('.service-points-table')?.textContent?.includes('KOTPRINTER'), 'Confirmed deletion removes only the selected row');
  assert(deletes.length === 2 && deletes.every(path => path.endsWith('/saved')), 'Deletion retry targets only the selected service point');
  root.unmount(); document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), checks }); });
