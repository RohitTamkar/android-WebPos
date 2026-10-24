import { createRoot } from 'react-dom/client';
import App from '../src/App.tsx';
import '../src/index.css';

const checks: string[] = [];
function assert(value: unknown, message: string) { if (!value) throw new Error(message); checks.push(message); }
const pause = () => new Promise(resolve => setTimeout(resolve, 20));
async function until(check: () => unknown, label: string) { for (let i = 0; i < 150; i++) { if (check()) return; await pause(); } throw new Error(`Timeout: ${label}`); }
const calls: { path: string; body: any; headers: Headers }[] = [];
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
let hangStop = false, hangHeartbeat = false;
const metadata = (id: string, sequence = 0) => ({ outletId: id, sessionId: `session-${id}`, generation: 'generation', sequence,
  usedSeconds: used, remainingSeconds: 1800 - used, date: '2026-10-19', timeZone: 'Asia/Kolkata' });
window.fetch = async (input, init) => {
  const path = String(input), headers = new Headers(init?.headers);
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  calls.push({ path, body, headers });
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
void (async () => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  root.render(<App />);
  await until(() => content().includes('Checking outlet access'), 'background startup');
  assert(!calls.some(call => call.path.endsWith('/usage/start')), 'Background startup does not open an active usage lease');
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  document.dispatchEvent(new Event('visibilitychange'));
  await until(() => releaseStart, 'restored outlet entry');
  assert(content().includes('Checking outlet access') && document.querySelector('.sidebar-nav') && !document.querySelector('.outlet-selection-page'), 'Disabled usage screen stays closed while initial admission remains pending');
  assert(!calls.some(call => call.path.includes('/dashboard')), 'Protected data is not requested before outlet admission');
  assert(button('Retry connection'), 'Pending outlet admission offers a retry without requiring an error first');
  const abandonedStart = releaseStart;
  button('Retry connection').click();
  await until(() => releaseStart !== abandonedStart, 'retry pending startup');
  abandonedStart!(); await pause();
  assert(!calls.some(call => call.path.includes('/dashboard')), 'A late abandoned response cannot admit the outlet');
  defer = false; releaseStart!(); await until(() => document.querySelector('.sidebar-nav') && !document.querySelector('[data-outlet-access-notice]'), 'admitted outlet');
  const key = sessionStorage.getItem('pos_web_usage:A'); assert(key, 'Refresh idempotency key is stored separately from usage totals');
  await tick(); assert(calls.some(call => call.path.endsWith('/usage/heartbeat')), 'Active sessions renew on the heartbeat interval');
  assert(used === 55, 'Heartbeat response comes from the backend; browser does not increment a stored counter');
  hangStop = true;
  now += 61_000; await tick(); await until(() => content().includes('Web POS usage paused'), 'idle pause');
  assert(calls.some(call => call.path.endsWith('/usage/stop')), 'Inactivity settles and releases the session');
  const idleHeartbeats = calls.filter(call => call.path.endsWith('/usage/heartbeat')).length;
  await tick(); assert(calls.filter(call => call.path.endsWith('/usage/heartbeat')).length === idleHeartbeats, 'Paused sessions do not renew from dashboard polling');
  button('Continue / Retry').click();
  await pause();
  assert(!content().includes('Continue / Retry'), 'Retry immediately shows progress instead of leaving an unresponsive button');
  await until(() => document.querySelector('.sidebar-nav') && !document.querySelector('[data-outlet-access-notice]'), 'resume after stalled stop');
  assert(document.querySelector('.sidebar-nav'), 'Continue cancels a stalled release response and resumes access');
  assert(used === 55, 'Resume retains the same-day backend usage value');
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  document.dispatchEvent(new Event('visibilitychange'));
  await until(() => calls.filter(call => call.path.endsWith('/usage/stop')).length >= 2, 'hidden pause');
  assert(document.querySelector('.sidebar-nav') && !content().includes('Web POS access paused'), 'Hidden page keeps its current screen mounted');
  const hiddenHeartbeats = calls.filter(call => call.path.endsWith('/usage/heartbeat')).length;
  await tick(); assert(calls.filter(call => call.path.endsWith('/usage/heartbeat')).length === hiddenHeartbeats, 'Hidden pages release their lease and never renew in the background');
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  const startsBeforeResume = calls.filter(call => call.path.endsWith('/usage/start')).length;
  document.dispatchEvent(new Event('visibilitychange'));
  await until(() => calls.filter(call => call.path.endsWith('/usage/start')).length > startsBeforeResume, 'automatic visible resume');
  await pause();
  button('Change outlet').click(); await until(() => content().includes('Select an outlet'), 'leave admitted outlet');
  defer = true;
  const startBeforeReentry = releaseStart;
  const readsBeforeReentry = calls.filter(call => call.path.includes('/dashboard')).length;
  await enter(0); await until(() => releaseStart !== startBeforeReentry, 'same outlet awaits fresh admission');
  assert(document.querySelector('[data-outlet-access-notice]') && !document.querySelector('.dashboard-columns'), 'Reentering the same outlet still waits for fresh server admission');
  assert(calls.filter(call => call.path.includes('/dashboard')).length === readsBeforeReentry, 'Previous admission cannot authorize new requests after leaving the outlet');
  defer = false; releaseStart!();
  await until(() => document.querySelector('.dashboard-columns') && !document.querySelector('[data-outlet-access-notice]'), 'same outlet readmitted');
  hangHeartbeat = true; await tick();
  button('Change outlet').click();
  await until(() => content().includes('Select an outlet'), 'switch with stalled heartbeat');
  assert(content().includes('Select an outlet'), 'Change outlet navigates even while a heartbeat response body is stalled');
  const switchIndex = calls.length; await enter(1); await until(() => document.querySelector('.sidebar-nav') && !document.querySelector('[data-outlet-access-notice]'), 'outlet B');
  assert(calls.slice(switchIndex).some(call => call.path === '/api/outlets/B/usage/start'), 'Switching outlets starts a distinct authorized outlet session');
  protectDenied = true; await window.fetch('/api/outlets/B/dashboard?dayId=2026-10-19', { headers: { Authorization: 'Bearer mock-session' } }); await until(() => content().includes('Daily usage limit reached'), 'protected denial');
  assert(document.querySelector('.sidebar-nav') && document.querySelector('[data-outlet-access-notice][role="alert"]') && !document.querySelector('.outlet-selection-page'), 'Backend exhaustion stays visible inline without opening the disabled usage screen');
  const requestsBeforeBlockedRead = calls.length;
  const blockedRead = await window.fetch('/api/outlets/B/dashboard?dayId=2026-10-19', { headers: { Authorization: 'Bearer mock-session' } });
  assert(blockedRead.status === 428 && calls.length === requestsBeforeBlockedRead, 'A denied lease cannot send further protected requests');
  button('Change outlet').click(); await until(() => content().includes('Select an outlet'), 'recover selection');
  protectDenied = false; block = true; await enter(0); await until(() => content().includes('Daily usage limit reached'), 'blocked new entry');
  assert(document.querySelector('[data-outlet-access-notice][role="alert"]') && !document.querySelector('.dashboard-columns'), 'Exhausted outlet cannot load protected workspace data after selection');
  button('Change outlet').click(); await until(() => content().includes('Select an outlet'), 'select again');
  block = false; invalidTimezone = true; await enter(0); await until(() => content().includes('country.timezone'), 'configuration failure');
  assert(document.querySelector('[data-outlet-access-notice][role="alert"]') && !document.querySelector('.dashboard-columns'), 'An explicitly invalid outlet timezone fails closed without opening the disabled screen');
  defer = true; const priorStart = releaseStart;
  button('Continue / Retry').click(); await until(() => releaseStart !== priorStart, 'stalled entry request');
  button('Sign out').click(); await until(() => !localStorage.getItem('pos_user_session'), 'logout despite stalled entry');
  assert(!localStorage.getItem('pos_user_session'), 'Sign out remains responsive while an entry request is stalled');
  assert(!localStorage.getItem('pos_selected_outlet'), 'Logout clears the existing browser session and outlet selection');
  root.unmount(); document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, failed: 0, checks });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: 1, error: String(error), checks }); });
