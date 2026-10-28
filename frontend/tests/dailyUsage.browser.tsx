import { createRoot } from 'react-dom/client';
import App from '../src/App.tsx';
import '../src/index.css';

const checks: string[] = [];
function assert(value: unknown, message: string) { if (!value) throw new Error(message); checks.push(message); }
const pause = () => new Promise(resolve => setTimeout(resolve, 20));
async function until(check: () => unknown, label: string) { for (let i = 0; i < 150; i++) { if (check()) return; await pause(); } throw new Error(`Timeout: ${label}`); }
const calls: { path: string; body: any; headers: Headers; signal?: AbortSignal | null }[] = [];
const timers = new Map<number, () => void>();
const nativeInterval = window.setInterval.bind(window), nativeClear = window.clearInterval.bind(window);
window.setInterval = ((callback: () => void, delay: number) => {
  if (delay !== 10_000) return nativeInterval(callback, delay);
  const id = nativeInterval(() => undefined, 1_000_000); timers.set(id, callback); return id;
}) as typeof window.setInterval;
window.clearInterval = ((id: number) => { timers.delete(id); nativeClear(id); }) as typeof window.clearInterval;
let now = Date.now(); Date.now = () => now;
const tick = async () => { [...timers.values()].forEach(callback => callback()); await pause(); };
const outlet = (id: string) => ({ id, name: `Outlet ${id}`, active: true, country: '', branch: 'Branch', dealerCode: '', fssaiNo: '' });
let block = false, invalidTimezone = false, protectDenied = false, defer = true;
let releaseStart: (() => void) | undefined;
let used = 45;
let hangStop = false, hangHeartbeat = false, slowStop = false;
const metadata = (id: string, sequence = 0) => ({ outletId: id, sessionId: `session-${id}`, generation: 'generation', sequence,
  dailyLimitApplies: true, usedSeconds: used, remainingSeconds: 1800 - used, date: '2026-10-19', timeZone: 'Asia/Kolkata' });
window.fetch = async (input, init) => {
  const path = String(input), headers = new Headers(init?.headers);
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  calls.push({ path, body, headers, signal: init?.signal });
  if (path === '/api/auth/login') return Response.json({ success: true, data: { token: 'mock-session', user: { id: 'user', email: 'test@example.com', name: 'User', role: 'Admin', terminal: 'POS' } } });
  assert(headers.get('Authorization') === 'Bearer mock-session', 'Existing JWT authentication is retained');
  const lifecycle = path.match(/^\/api\/outlets\/([^/]+)\/usage\/(start|heartbeat|stop)$/);
  if (lifecycle) {
    assert(!('usedSeconds' in body) && !('timestamp' in body) && !('date' in body), 'Client submits no counters or accounting timestamps');
    const [, id, action] = lifecycle;
    if (action === 'start') {
      if (defer) await new Promise<void>(resolve => { releaseStart = resolve; });
      if (block) return Response.json({ success: false, code: 'USAGE_LIMIT_REACHED', message: 'Daily 30-minute allowance exhausted.' }, { status: 403 });
      if (invalidTimezone) return Response.json({ success: false, code: 'USAGE_UNAVAILABLE', message: 'Outlet country.timezone is invalid.' }, { status: 422 });
    }
    if ((action === 'stop' && hangStop) || (action === 'heartbeat' && hangHeartbeat)) {
      hangStop = false; hangHeartbeat = false;
      return { ok: true, status: 200, json: () => new Promise(() => undefined) } as unknown as Response;
    }
    if (action === 'stop' && slowStop) { slowStop = false; await new Promise(resolve => setTimeout(resolve, 100)); }
    if (action === 'heartbeat') used += 10;
    return Response.json({ success: true, data: metadata(id!, action === 'heartbeat' ? body.sequence : 0) });
  }
  if (path === '/api/auth/outlets') return Response.json({ success: true, data: { outlets: [outlet('A'), outlet('B')] } });
  if (path.includes('/dashboard?')) {
    assert(headers.get('X-Web-Usage-Session') && headers.get('X-Web-Usage-Outlet') && headers.get('X-Web-Usage-Generation'), 'Protected requests include the authorized usage session');
    if (protectDenied) return Response.json({ success: false, code: 'USAGE_LIMIT_REACHED', message: 'Daily 30-minute allowance exhausted.' }, { status: 403 });
    return Response.json({ success: true, data: { payments: {}, shifts: [] } });
  }
  throw new Error(`Unexpected API: ${path}`);
};
localStorage.clear(); sessionStorage.clear();
localStorage.setItem('pos_user_session', JSON.stringify({ id: 'user', email: 'test@example.com', name: 'User', role: 'Admin', terminal: 'POS', token: 'mock-session' }));
localStorage.setItem('pos_selected_outlet', JSON.stringify(outlet('A')));
const root = createRoot(document.getElementById('root')!);
const content = () => document.body.textContent || '';
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === label)!;
async function enter(index: number) {
  await until(() => document.querySelectorAll('.outlet-card button').length > index, 'outlet list');
  document.querySelectorAll<HTMLButtonElement>('.outlet-card button')[index]!.click(); await pause();
}
async function loginAgain() {
  await until(() => document.getElementById('crm-email'), 'automatic logout');
  for (const [id, value] of [['crm-email', 'test@example.com'], ['crm-quick-pin', '1234']]) {
    const element = document.getElementById(id!)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }
  await pause(); document.querySelector<HTMLFormElement>('.crm-password-form')!.requestSubmit();
  await until(() => document.querySelector('.outlet-selection-page'), 'authenticated outlet selection');
}
void (async () => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  root.render(<App />);
  await until(() => document.querySelector('.dashboard-workspace')?.getAttribute('aria-hidden') === 'true', 'background startup');
  assert(!calls.some(call => call.path.endsWith('/usage/start')), 'Background startup does not open an active usage lease');
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  document.dispatchEvent(new Event('visibilitychange'));
  await until(() => releaseStart, 'restored outlet entry');
  assert(!document.querySelector('[data-outlet-admission]') && !document.querySelector('.outlet-lockout') && document.querySelector('.dashboard-workspace')!.getAttribute('aria-hidden') === 'true', 'Unknown policy shows no usage screens and keeps protected content hidden');
  assert(!calls.some(call => call.path.includes('/dashboard')), 'Protected data is not requested before outlet admission');
  assert(!button('Retry connection') && !document.querySelector('[data-outlet-connection]'), 'Normal admission has no connection banner or retry/sign-out strip');
  defer = false; releaseStart!(); await until(() => document.querySelector('.dashboard-columns') && !document.querySelector('[data-outlet-access-notice]') && !document.querySelector('[data-outlet-connection]'), 'admitted outlet');
  const key = sessionStorage.getItem('pos_web_usage:A'); assert(key, 'Refresh idempotency key is stored separately from usage totals');
  await tick(); assert(calls.some(call => call.path.endsWith('/usage/heartbeat')), 'Active sessions renew on the heartbeat interval');
  assert(used === 55, 'Heartbeat response comes from the backend; browser does not increment a stored counter');
  hangStop = true;
  now += 61_000; await tick(); await until(() => content().includes('Web POS usage paused'), 'idle pause');
  assert(calls.some(call => call.path.endsWith('/usage/stop')), 'Inactivity settles and releases the session');
  const idleHeartbeats = calls.filter(call => call.path.endsWith('/usage/heartbeat')).length;
  await tick(); assert(calls.filter(call => call.path.endsWith('/usage/heartbeat')).length === idleHeartbeats, 'Paused sessions do not renew from dashboard polling');
  button('Continue / Resume').click();
  await pause();
  assert(!content().includes('Continue / Resume'), 'Retry immediately shows progress instead of leaving an unresponsive button');
  await until(() => document.querySelector('.dashboard-columns') && !document.querySelector('[data-outlet-access-notice]') && !document.querySelector('[data-outlet-connection]'), 'resume after stalled stop');
  assert(document.querySelector('.sidebar-nav'), 'Continue cancels a stalled release response and resumes access');
  assert(used === 55, 'Resume retains the same-day backend usage value');
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  document.dispatchEvent(new Event('visibilitychange'));
  await until(() => calls.filter(call => call.path.endsWith('/usage/stop')).length >= 2, 'hidden pause');
  assert(document.querySelector('.sidebar-nav') && document.querySelector('.retail-dashboard-shell')!.getAttribute('aria-hidden') === 'true', 'Hidden page preserves its mounted editor while hiding the application');
  const hiddenHeartbeats = calls.filter(call => call.path.endsWith('/usage/heartbeat')).length;
  await tick(); assert(calls.filter(call => call.path.endsWith('/usage/heartbeat')).length === hiddenHeartbeats, 'Hidden pages release their lease and never renew in the background');
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  const startsBeforeResume = calls.filter(call => call.path.endsWith('/usage/start')).length;
  document.dispatchEvent(new Event('visibilitychange'));
  await pause();
  assert(calls.filter(call => call.path.endsWith('/usage/start')).length === startsBeforeResume, 'Returning to a hidden tab waits for explicit Resume');
  button('Continue / Resume').click();
  await until(() => calls.filter(call => call.path.endsWith('/usage/start')).length > startsBeforeResume && !document.querySelector('[data-outlet-access-notice]') && !document.querySelector('[data-outlet-admission]'), 'manual visible resume');
  await pause();
  document.querySelector<HTMLButtonElement>('.business-outlet-switch')!.click(); await until(() => content().includes('Select an outlet'), 'leave admitted outlet');
  defer = true;
  const startBeforeReentry = releaseStart;
  const readsBeforeReentry = calls.filter(call => call.path.includes('/dashboard')).length;
  await enter(0); await until(() => releaseStart !== startBeforeReentry, 'same outlet awaits fresh admission');
  assert(!document.querySelector('[data-outlet-connection]') && !document.querySelector('.outlet-lockout') && !document.querySelector('[data-outlet-admission]') && !document.querySelector('.dashboard-columns'), 'Reentering the same outlet waits for fresh authorization without a daily restriction popup');
  assert(calls.filter(call => call.path.includes('/dashboard')).length === readsBeforeReentry, 'Previous admission cannot authorize new requests after leaving the outlet');
  defer = false; releaseStart!();
  await until(() => document.querySelector('.dashboard-columns') && !document.querySelector('[data-outlet-access-notice]') && !document.querySelector('[data-outlet-admission]'), 'same outlet readmitted');
  hangHeartbeat = true; await tick();
  document.querySelector<HTMLButtonElement>('.business-outlet-switch')!.click();
  await until(() => content().includes('Select an outlet'), 'switch with stalled heartbeat');
  assert(content().includes('Select an outlet'), 'Change outlet navigates even while a heartbeat response body is stalled');
  const switchIndex = calls.length; await enter(1); await until(() => document.querySelector('.dashboard-columns') && !document.querySelector('[data-outlet-access-notice]') && !document.querySelector('[data-outlet-connection]'), 'outlet B');
  assert(calls.slice(switchIndex).some(call => call.path === '/api/outlets/B/usage/start'), 'Switching outlets starts a distinct authorized outlet session');
  const stopsBeforeExhaustion = calls.filter(call => call.path === '/api/outlets/B/usage/stop').length;
  slowStop = true; protectDenied = true; await window.fetch('/api/outlets/B/dashboard?dayId=2026-10-19', { headers: { Authorization: 'Bearer mock-session' } }); await until(() => document.querySelector('.outlet-lockout [disabled]'), 'protected denial locks the full screen');
  await until(() => calls.filter(call => call.path === '/api/outlets/B/usage/stop').length > stopsBeforeExhaustion, 'exhaustion cleanup');
  await pause();
  assert(calls.filter(call => call.path === '/api/outlets/B/usage/stop').length === stopsBeforeExhaustion + 1, 'Protected API exhaustion releases the lease exactly once');
  assert(!calls.filter(call => call.path === '/api/outlets/B/usage/stop').at(-1)!.signal?.aborted, 'Repeated logout cleanup does not abort the pending stop request');
  assert(!localStorage.getItem('pos_user_session') && !localStorage.getItem('pos_selected_outlet') && !document.querySelector('.retail-dashboard-shell') && button('Continue / Resume').disabled, 'Backend exhaustion automatically clears authentication and hides all POS data');
  const requestsBeforeBlockedRead = calls.length;
  const blockedRead = await window.fetch('/api/outlets/B/dashboard?dayId=2026-10-19', { headers: { Authorization: 'Bearer mock-session' } });
  assert(blockedRead.status === 428 && calls.length === requestsBeforeBlockedRead, 'A denied lease cannot send further protected requests');
  button('Sign Out').click(); await loginAgain();
  protectDenied = false; block = true; await enter(0);
  await until(() => document.querySelector('.outlet-lockout [disabled]'), 'blocked new entry shows lockout');
  assert(!document.querySelector('.dashboard-columns') && button('Continue / Resume').disabled, 'Exhausted outlet cannot load protected workspace data after selection');
  button('Sign Out').click(); await loginAgain();
  block = false; invalidTimezone = true; await enter(0); await until(() => content().includes('country.timezone'), 'configuration failure');
  assert(document.querySelector('[data-outlet-connection]') && !document.querySelector('[data-outlet-access-notice]') && !document.querySelector('.dashboard-columns'), 'An invalid unverified outlet fails closed without assuming a daily restriction');
  defer = true; const priorStart = releaseStart;
  button('Retry connection').click(); await until(() => releaseStart !== priorStart, 'stalled entry request');
  document.querySelector<HTMLButtonElement>('.sidebar-logout')!.click();
  await until(() => document.querySelector('.logout-modal-actions .confirm'), 'logout confirmation during pending admission');
  document.querySelector<HTMLButtonElement>('.logout-modal-actions .confirm')!.click();
  await until(() => !localStorage.getItem('pos_user_session'), 'logout despite stalled entry');
  assert(!localStorage.getItem('pos_user_session'), 'Sign out remains responsive while an entry request is stalled');
  assert(!localStorage.getItem('pos_selected_outlet'), 'Logout clears the existing browser session and outlet selection');
  root.unmount(); document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, failed: 0, checks });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: 1, error: String(error), checks }); });
