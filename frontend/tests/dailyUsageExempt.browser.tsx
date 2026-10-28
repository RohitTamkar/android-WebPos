// Real App and usage client; every API operation is isolated in this fixture.
import { createRoot } from 'react-dom/client';
import App from '../src/App.tsx';
import '../src/index.css';
const passed: string[] = [];
const assert = (ok: unknown, message: string) => { if (!ok) throw new Error(message); passed.push(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 20));
async function until(check: () => unknown, label: string) { for (let i = 0; i < 150; i++) { if (check()) return; await pause(); } throw new Error(`Timeout: ${label}`); }
const flags: Record<string, boolean> = { A: true, B: false };
const used: Record<string, number> = { A: 1800, B: 1800 };
const sequences: Record<string, number> = { A: 0, B: 0 };
const user = { id: 'u', name: 'User', email: 'user@example.com', role: 'Admin', terminal: 'POS' };
// Cached frontend flags deliberately disagree with the backend fixture policy.
const outlet = (id: string) => ({ id, name: `Outlet ${id}`, branch: '', country: '', active: true, eraseOutlet: !flags[id] });
let admit: (() => void) | undefined, finishStale: (() => void) | undefined, defer = true;
let now = Date.now(); Date.now = () => now;
let failNextStart = false, delayStop = false, expireNextHeartbeat = false, expireNextApi = false;
let completeStop: (() => void) | undefined;
const calls: string[] = [];
const timers = new Map<number, () => void>();
const nativeInterval = window.setInterval.bind(window), nativeClear = window.clearInterval.bind(window);
window.setInterval = ((fn: () => void, delay: number) => {
  if (delay !== 10000) return nativeInterval(fn, delay);
  const id = nativeInterval(() => undefined, 1000000); timers.set(id, fn); return id;
}) as typeof window.setInterval;
window.clearInterval = ((id: number) => { timers.delete(id); nativeClear(id); }) as typeof window.clearInterval;
const exhausted = (applies = true) => Response.json({ success: false, code: 'USAGE_LIMIT_REACHED', dailyLimitApplies: applies, message: 'Daily allowance exhausted.' }, { status: 403 });
window.fetch = async (input, init) => {
  const path = String(input); calls.push(path);
  if (path === '/api/auth/login') return Response.json({ success: true, data: { token: 'token', user } });
  if (new Headers(init?.headers).get('Authorization') !== 'Bearer token') throw new Error('Authentication required');
  if (path === '/api/auth/outlets') return Response.json({ success: true, data: { outlets: [outlet('A'), outlet('B')] } });
  const match = path.match(/^\/api\/outlets\/([AB])\/(.*)$/);
  if (!match) throw new Error(`Unexpected route: ${path}`);
  const [, id, action] = match as [string, string, string];
  if (action === 'products?stale=1') { await new Promise<void>(resolve => { finishStale = resolve; }); return exhausted(); }
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  if (action === 'usage/stop' && delayStop) { delayStop = false; await new Promise<void>(resolve => { completeStop = resolve; }); }
  if ((action === 'usage/heartbeat' && expireNextHeartbeat) || (action === 'products' && expireNextApi)) {
    expireNextHeartbeat = false; expireNextApi = false;
    return Response.json({ success: false, code: 'USAGE_SESSION_EXPIRED', dailyLimitApplies: false, message: 'Reconnect your outlet session.' }, { status: 428 });
  }
  if (action === 'usage/start' && failNextStart) { failNextStart = false; return Response.json({ success: false, message: 'Unable to verify outlet session.' }, { status: 503 }); }
  if (action === 'usage/start' && defer) await new Promise<void>(resolve => { admit = resolve; });
  if (action !== 'usage/stop' && !flags[id] && used[id]! >= 1800) return exhausted();
  if (action.startsWith('usage/')) {
    if (action === 'usage/start') sequences[id]!++;
    if (action === 'usage/heartbeat') sequences[id] = body.sequence;
    return Response.json({ success: true, data: { outletId: id, sessionId: `session-${id}`, generation: 'generation', sequence: sequences[id],
      dailyLimitApplies: !flags[id], usedSeconds: used[id], remainingSeconds: 0, date: '2026-10-28', timeZone: 'Asia/Kolkata' } });
  }
  if (!new Headers(init?.headers).get('X-Web-Usage-Session')) throw new Error('Lease required');
  return Response.json({ success: true, data: action.includes('dashboard?') ? { payments: {}, shifts: [] } : [] });
};
localStorage.clear(); sessionStorage.clear(); history.replaceState(null, '');
localStorage.setItem('pos_user_session', JSON.stringify({ ...user, token: 'token' })); localStorage.setItem('pos_selected_outlet', JSON.stringify(outlet('A')));
let root = createRoot(document.getElementById('root')!);
const popup = () => document.querySelector<HTMLDialogElement>('.outlet-lockout');
const ready = () => document.querySelector('.dashboard-workspace')?.getAttribute('aria-hidden') !== 'true' && document.querySelector('.dashboard-columns') && !popup() && !document.querySelector('[data-outlet-admission]') && !document.querySelector('[data-outlet-connection]');
const choose = async (index: number) => { await until(() => document.querySelectorAll('.outlet-card button').length === 2, 'outlet picker'); document.querySelectorAll<HTMLButtonElement>('.outlet-card button')[index]!.click(); };
const signIn = async () => {
  await until(() => document.getElementById('crm-email'), 'login');
  for (const [id, value] of [['crm-email', user.email], ['crm-quick-pin', '1234']]) {
    const element = document.getElementById(id!)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true }));
  }
  await pause(); document.querySelector<HTMLFormElement>('.crm-password-form')!.requestSubmit();
};
void (async () => {
  root.render(<App />); await until(() => admit, 'admission');
  assert(!popup() && !document.querySelector('[data-outlet-admission]') && !document.querySelector('[data-outlet-connection]'), 'Startup shows no connection banner or full-screen usage notices before exemption is verified');
  assert(!calls.some(path => path.includes('/A/') && !path.includes('/usage/')), 'Unknown policy still cannot authorize protected API requests');
  defer = false; admit!(); await until(ready, 'exempt outlet');
  assert(!popup() && !!localStorage.getItem('pos_user_session'), 'Backend exemption at 1800 seconds ignores the contrary cached outlet flag');
  [...timers.values()].forEach(tick => tick()); await pause();
  assert(ready() && used.A === 1800, 'Exempt heartbeat at the cap never logs out or shows an allowance warning');
  now += 61_000;
  [...timers.values()].forEach(tick => tick()); await pause();
  assert(ready() && !popup() && !calls.some(path => path.endsWith('/usage/stop')), 'An exempt outlet stays usable after inactivity without the pause popup');
  const oldRequest = fetch('/api/outlets/A/products?stale=1', { headers: { Authorization: 'Bearer token' } });
  await until(() => finishStale, 'old request pending');
  delayStop = true;
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); document.dispatchEvent(new Event('visibilitychange'));
  await until(() => completeStop, 'background lease release'); await pause();
  assert(!popup() && document.querySelector('.retail-dashboard-shell')!.getAttribute('aria-hidden') !== 'true', 'Exempt tab switching releases its lease without a pause popup');
  defer = true; admit = undefined;
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); window.dispatchEvent(new Event('focus'));
  await until(() => admit, 'automatic exempt admission begins');
  assert(!popup(), 'A slow background release does not create a popup while exempt reauthorization is pending');
  defer = false; admit!(); completeStop!();
  await until(() => sequences.A! > 1 && ready(), 'automatic exempt admission');
  assert(!popup(), 'Returning to an exempt outlet silently renews authorization without pressing Resume');
  finishStale!(); await oldRequest; await pause();
  assert(ready() && !!localStorage.getItem('pos_user_session'), 'A delayed exhausted response from the previous lease cannot lock or log out the current exempt session');
  document.querySelector<HTMLButtonElement>('.business-outlet-switch')!.click(); await choose(1);
  await until(() => popup()?.textContent?.includes('Your outlet session has ended'), 'restricted exhaustion');
  assert(!localStorage.getItem('pos_user_session') && !localStorage.getItem('pos_selected_outlet') && used.B === 1800, 'Restricted exhaustion automatically clears authentication and outlet state without resetting usage');
  document.querySelector<HTMLButtonElement>('.outlet-lockout-change')!.click(); await signIn(); await choose(0); await until(ready, 'exempt outlet after restricted logout');
  assert(!popup(), 'An exempt outlet cannot inherit the previous restricted outlet notice');
  root.unmount(); await pause(); root = createRoot(document.getElementById('root')!); root.render(<App />); await until(ready, 'refresh');
  assert(!popup() && used.A === 1800, 'Refresh preserves exemption and counters without restoring a stale popup');
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); await pause();
  failNextStart = true;
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); document.dispatchEvent(new Event('visibilitychange'));
  await until(() => document.querySelector('.dashboard-workspace')?.getAttribute('aria-hidden') === 'true', 'failed silent authorization');
  assert(!popup() && !document.querySelector('[data-outlet-admission]') && !document.querySelector('[data-outlet-connection]') && document.querySelector('.dashboard-workspace')!.getAttribute('aria-hidden') === 'true', 'Exempt recovery hides protected content without either full-screen popup');
  await until(ready, 'automatic verified retry');
  assert(!popup() && !document.querySelector('[data-outlet-admission]') && !document.querySelector('[data-outlet-connection]'), 'Transient errors recover automatically without requiring Resume');
  expireNextHeartbeat = true; [...timers.values()].forEach(tick => tick());
  await until(() => document.querySelector('.dashboard-workspace')?.getAttribute('aria-hidden') === 'true', 'expired exempt heartbeat');
  assert(!popup() && !document.querySelector('[data-outlet-admission]') && !document.querySelector('[data-outlet-connection]'), 'An expired exempt heartbeat never opens either usage screen');
  await until(ready, 'heartbeat auto recovery');
  expireNextApi = true; await fetch('/api/outlets/A/products', { headers: { Authorization: 'Bearer token' } });
  await until(() => document.querySelector('.dashboard-workspace')?.getAttribute('aria-hidden') === 'true', 'expired direct API lease');
  assert(!popup() && !document.querySelector('[data-outlet-admission]') && !document.querySelector('[data-outlet-connection]'), 'Protected-request lease expiry also recovers without either exempt popup');
  await until(ready, 'API auto recovery');
  localStorage.setItem('pos_selected_outlet', JSON.stringify(outlet('B')));
  window.dispatchEvent(new StorageEvent('storage', { key: 'pos_selected_outlet', storageArea: localStorage }));
  await until(() => document.querySelector('.outlet-card button'), 'exempt cross-tab outlet change');
  assert(!popup() && !document.querySelector('[data-outlet-admission]') && JSON.parse(localStorage.getItem('pos_selected_outlet')!).id === 'B', 'Exempt cross-tab outlet changes return to selection without a usage popup or overwriting the other tab');
  await choose(0); await until(ready, 'exempt outlet selected again');
  localStorage.removeItem('pos_user_session');
  window.dispatchEvent(new StorageEvent('storage', { key: 'pos_user_session', storageArea: localStorage }));
  await until(() => document.getElementById('crm-email'), 'exempt cross-tab logout');
  assert(!popup() && !document.querySelector('[data-outlet-admission]') && !document.querySelector('[data-outlet-connection]'), 'Exempt cross-tab logout goes straight to login without either usage screen');
  await signIn(); await choose(0); await until(ready, 'relogin after cross-tab logout');
  flags.A = false;
  await fetch('/api/outlets/A/products', { headers: { Authorization: 'Bearer token' } });
  await until(() => popup()?.textContent?.includes('Your outlet session has ended'), 'authoritative policy change');
  assert(!localStorage.getItem('pos_user_session'), 'A fresh backend restriction overrides previously accepted exemption and automatically logs out');
  document.querySelector<HTMLButtonElement>('.outlet-lockout-signout')!.click(); await until(() => document.getElementById('crm-email') && !popup(), 'login flow');
  assert(!localStorage.getItem('pos_selected_outlet'), 'Sign Out dismisses the restricted notice into the existing login flow');
  root.unmount(); document.getElementById('test-results')!.textContent = JSON.stringify({ passed });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ passed, failed: String(error) }); });
