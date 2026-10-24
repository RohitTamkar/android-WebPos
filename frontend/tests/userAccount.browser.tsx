import { createRoot } from 'react-dom/client';
import App from '../src/App.tsx';
import '../src/index.css';

localStorage.clear();
localStorage.setItem('pos_user_session', JSON.stringify({ id: 'signed-user', name: 'Session Name', email: 'session@example.com', role: 'Admin', terminal: 'POS', token: 'mock-token' }));
localStorage.setItem('pos_selected_outlet', JSON.stringify({ id: 'shop', name: 'Existing Shop' }));
const checks: string[] = [];
function assert(ok: unknown, message: string) { if (!ok) throw new Error(message); checks.push(message); }
const pause = () => new Promise(resolve => setTimeout(resolve, 30));
async function until(check: () => unknown, message: string) {
  for (let i = 0; i < 120; i++) { if (check()) return; await pause(); }
  throw new Error('Timeout: ' + message);
}
let profile: { name: string | null; email: string | null; hasLoginPin: boolean; loginPin: string | null } = { name: 'Database Name', email: 'database@example.com', hasLoginPin: true, loginPin: '012345' };
let getStatus = 200, saveStatus = 200;
let releaseGet: (() => void) | undefined;
let releaseSave: (() => void) | undefined;
let waitForSave = false;
const patches: Record<string, string>[] = [];
window.fetch = async (input, init) => {
  const path = String(input);
  if (path.includes('/dashboard?')) return Response.json({ data: { dayId: '2026-10-19', payments: {} } });
  if (path !== '/api/auth/account') throw new Error('Unexpected API: ' + path);
  assert((init?.headers as Record<string, string>).Authorization === 'Bearer mock-token', 'Account requests include the session token');
  if (init?.method === 'PATCH') {
    const patch = JSON.parse(String(init.body)); patches.push(patch);
    if (waitForSave) await new Promise<void>(resolve => { releaseSave = resolve; });
    if (saveStatus !== 200) return Response.json({ message: 'Save failed. Please try again.' }, { status: saveStatus });
    profile = { ...profile, ...patch };
    return Response.json({ success: true, data: profile });
  }
  assert(init?.cache === 'no-store', 'Account loads fresh database data');
  await new Promise<void>(resolve => { releaseGet = resolve; });
  return Response.json(getStatus === 200 ? { success: true, data: profile } : { message: 'Unable to load account' }, { status: getStatus });
};
const root = createRoot(document.getElementById('root')!);
root.render(<App />);
function nav(label: string) { return [...document.querySelectorAll<HTMLButtonElement>('.nav-group-items button')].find(button => button.textContent === label)!; }
function input(name: string) { return document.querySelector<HTMLInputElement>(`.user-account-page input[name="${name}"]`)!; }
function edit(name: string, value: string) {
  const element = input(name);
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
}
const save = () => document.querySelector<HTMLButtonElement>('.user-account-page button[type=submit]')!;
async function openAccount() {
  releaseGet = undefined;
  nav('User Account').click();
  await until(() => releaseGet, 'account request');
  assert(document.querySelector('.user-account-page [role=status]')?.textContent?.includes('Loading'), 'Account form shows loading while fetching');
  releaseGet!();
}
void (async () => {
  await until(() => nav('User Account'), 'menu');
  await openAccount(); await until(() => input('name'), 'account form');
  assert(document.querySelector('h1')?.textContent === 'User Account', 'User Account menu opens the account page');
  const bounds = document.querySelector('.user-account-card')!.getBoundingClientRect();
  assert(bounds.left >= 0 && bounds.right <= innerWidth, 'Account form fits the viewport');
  const light = getComputedStyle(document.querySelector('.user-account-card')!).backgroundColor;
  document.querySelector<HTMLButtonElement>('.theme-button')!.click(); await pause();
  assert(getComputedStyle(document.querySelector('.user-account-card')!).backgroundColor !== light, 'Account form follows the existing dark theme');
  assert(input('name').value === 'Database Name' && input('email').value === 'database@example.com', 'Fields come from the database rather than cached session values');
  const pin = document.querySelector<HTMLInputElement>('#account-login-pin')!;
  assert(pin.readOnly && pin.type === 'text' && pin.value === '012345' && !pin.name, 'Current login PIN is displayed read-only with leading zeroes and is never submitted');
  assert(save().disabled, 'Unchanged form cannot be saved');
  edit('name', 'Edited Name'); await pause(); waitForSave = true;
  save().click(); await until(() => releaseSave, 'save request');
  assert(input('name').matches(':disabled') && save().disabled, 'Controls are disabled during save');
  assert(!document.querySelector('.user-account-success'), 'Success is not shown before the update succeeds');
  releaseSave!(); await until(() => document.querySelector('.user-account-success'), 'saved name'); waitForSave = false;
  assert(JSON.stringify(patches[0]) === JSON.stringify({ name: 'Edited Name' }), 'Name save submits only the edited name');
  assert(input('email').value === 'database@example.com' && save().disabled, 'Unedited email stays unchanged and saved values become the baseline');
  const session = JSON.parse(localStorage.getItem('pos_user_session')!);
  assert(session.name === 'Edited Name' && session.id === 'signed-user' && session.token === 'mock-token' && session.role === 'Admin', 'Confirmed save updates display state while preserving session identity and permissions');
  assert(document.querySelector('.profile-menu-trigger strong')?.textContent === 'Edited Name', 'Header reflects the confirmed name');
  edit('email', 'edited@example.com'); await pause(); save().click();
  await until(() => patches.length === 2 && !!document.querySelector('.user-account-success'), 'saved email');
  assert(JSON.stringify(patches[1]) === JSON.stringify({ email: 'edited@example.com' }), 'Email save submits only the edited email');
  edit('email', 'invalid'); await pause(); save().click(); await pause();
  assert(!input('email').validity.valid && patches.length === 2, 'Invalid emails are blocked before submission');
  edit('email', 'edited@example.com'); edit('name', '   '); await pause(); save().click(); await pause();
  assert(document.querySelector('[role=alert]')?.textContent === 'Name is required.' && patches.length === 2, 'Whitespace-only names are rejected');
  edit('name', 'Unsaved Name'); await pause(); saveStatus = 503; save().click();
  await until(() => document.querySelector('[role=alert]')?.textContent?.includes('Save failed'), 'save error');
  assert(input('name').value === 'Unsaved Name' && !save().disabled && profile.name === 'Edited Name', 'Failed saves retain editable values and do not claim a database update');
  saveStatus = 200;
  nav('Dashboard').click(); await pause(); getStatus = 503;
  await openAccount(); await until(() => document.querySelector('.user-account-page [role=alert]'), 'load error');
  assert(!input('name'), 'Fetch errors never display stale account details');
  getStatus = 200; releaseGet = undefined;
  document.querySelector<HTMLButtonElement>('.user-account-state button')!.click();
  await until(() => releaseGet, 'retry'); releaseGet!(); await until(() => input('name'), 'retry loaded');
  assert(input('name').value === 'Edited Name', 'Retry fetches the current saved record');
  nav('Dashboard').click(); await pause(); profile = { name: null, email: null, hasLoginPin: false, loginPin: null };
  await openAccount(); await until(() => document.querySelector('.user-account-page form'), 'missing fields');
  assert(!document.querySelector('.user-account-page input') && save().disabled, 'Fields absent from the database are not invented');
  nav('Dashboard').click(); await pause(); getStatus = 401;
  await openAccount(); await until(() => document.querySelector('.crm-login-page'), 'expired session');
  assert(localStorage.getItem('pos_user_session') === null, 'Expired session uses existing logout behavior');
  root.unmount();
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, failed: 0, checks });
})().catch(error => {
  document.getElementById('test-results')!.textContent = JSON.stringify({ failed: 1, error: String(error), checks });
});
