// Regression: the enabled compatibility indicator must preserve authoritative outlet policy.
import { createRoot } from 'react-dom/client';
import App from '../src/App.tsx';
import { DAILY_WEB_USAGE_ENABLED } from '../../shared/webUsageFeature.ts';
import '../src/index.css';
const passed: string[] = [];
const assert = (ok: unknown, message: string) => { if (!ok) throw new Error(message); passed.push(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 20));
async function until(check: () => unknown, label: string) { for (let i = 0; i < 150; i++) { if (check()) return; await pause(); } throw new Error(`Timeout: ${label}`); }
const flags: Record<string, boolean> = { A: true, B: false };
const used: Record<string, number> = { A: 1800, B: 1800 };
const calls: { path: string; body: any }[] = [];
const timers = new Map<number, () => void>();
const nativeInterval = window.setInterval.bind(window), nativeClear = window.clearInterval.bind(window);
window.setInterval = ((callback: () => void, delay: number) => {
  if (delay !== 10000) return nativeInterval(callback, delay);
  const id = nativeInterval(() => undefined, 1_000_000); timers.set(id, callback); return id;
}) as typeof window.setInterval;
window.clearInterval = ((id: number) => { timers.delete(id); nativeClear(id); }) as typeof window.clearInterval;
const outlet = (id: string) => ({ id, name: `Outlet ${id}`, active: true, branch: '', country: '', eraseOutlet: !flags[id] });
const metadata = (id: string, sequence = 0) => ({ outletId: id, sessionId: `session-${id}`, generation: 'generation', sequence, dailyLimitApplies: !flags[id], usedSeconds: used[id], remainingSeconds: 0, date: '2026-10-28', timeZone: 'Asia/Kolkata' });
const exhausted = () => Response.json({ success: false, code: 'USAGE_LIMIT_REACHED', message: 'Daily allowance exhausted.' }, { status: 403 });
window.fetch = async (input, init) => {
  const path = String(input), headers = new Headers(init?.headers), body = init?.body ? JSON.parse(String(init.body)) : {};
  calls.push({ path, body });
  if (path === '/api/auth/login') return Response.json({ success: true, data: { token: 'token', user: { id: 'u', name: 'User', email: 'user@example.com', role: 'Admin', terminal: 'POS' } } });
  if (headers.get('Authorization') !== 'Bearer token') throw new Error('Authentication missing');
  if (path === '/api/auth/outlets') return Response.json({ success: true, data: { outlets: [outlet('A'), outlet('B')] } });
  const match = path.match(/^\/api\/outlets\/([AB])\/(.*)$/);
  if (!match) throw new Error(`Unexpected route ${path}`);
  const [, id, action] = match;
  if (action!.startsWith('usage/')) {
    if (action !== 'usage/stop' && !flags[id!] && used[id!]! >= 1800) return exhausted();
    return Response.json({ success: true, data: metadata(id!, body.sequence ?? 0) });
  }
  if (!headers.get('X-Web-Usage-Session')) throw new Error('Usage session missing');
  if (!flags[id!] && used[id!]! >= 1800) return exhausted();
  return Response.json({ success: true, data: action!.includes('dashboard?') ? { payments: {}, shifts: [] } : [] });
};
localStorage.clear(); sessionStorage.clear();
localStorage.setItem('pos_user_session', JSON.stringify({ id: 'u', name: 'User', email: 'user@example.com', token: 'token', role: 'Admin', terminal: 'POS' }));
localStorage.setItem('pos_selected_outlet', JSON.stringify(outlet('A')));
const root = createRoot(document.getElementById('root')!);
const blocked = () => document.querySelector('[data-outlet-access-notice]');
const switchOutlet = async (index: number) => {
  document.querySelector<HTMLButtonElement>('.business-outlet-switch')!.click();
  await until(() => document.querySelectorAll('.outlet-card button').length === 2, 'outlet picker');
  document.querySelectorAll<HTMLButtonElement>('.outlet-card button')[index]!.click();
};
void (async () => {
  assert(DAILY_WEB_USAGE_ENABLED === true, 'Compatibility indicator is true during this browser test');
  root.render(<App />);
  await until(() => document.querySelector('.dashboard-columns') && !blocked(), 'exempt outlet admission');
  assert(calls.some(call => call.path === '/api/outlets/A/usage/start'), 'Admission runs with the enabled global indicator');
  assert(!blocked(), 'Exempt outlet with zero remaining seconds is not displayed as exhausted');
  [...timers.values()].forEach(tick => tick()); await pause();
  assert(calls.some(call => call.path === '/api/outlets/A/usage/heartbeat') && !blocked(), 'Exempt outlet continues renewing after 1800 seconds');
  const deniedPreview = await window.fetch('/api/outlets/B/products', { headers: { Authorization: 'Bearer token' } }); await pause();
  assert(deniedPreview.status === 403 && !blocked(), 'Restricted destination denial does not block an exempt source');
  const sourceRead = await window.fetch('/api/outlets/A/dashboard?dayId=2026-10-28', { headers: { Authorization: 'Bearer token' } });
  assert(sourceRead.ok, 'Exempt source retains its session after destination denial');
  await switchOutlet(1);
  await until(() => blocked()?.textContent?.includes('Daily limit reached'), 'restricted outlet lockout');
  assert(!document.querySelector('.dashboard-columns'), 'Restricted outlet is blocked even when cached outlet data claims exemption');
  flags.B = true;
  document.querySelector<HTMLButtonElement>('.outlet-lockout-change')!.click();
  await until(() => document.getElementById('crm-email'), 'login after automatic logout');
  for (const [id, value] of [['crm-email', 'user@example.com'], ['crm-quick-pin', '1234']]) {
    const field = document.getElementById(id!)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }
  await pause(); document.querySelector<HTMLFormElement>('.crm-password-form')!.requestSubmit();
  await until(() => document.querySelectorAll('.outlet-card button').length === 2, 'outlets after re-login');
  document.querySelectorAll<HTMLButtonElement>('.outlet-card button')[1]!.click();
  await until(() => document.querySelector('.dashboard-columns') && !blocked(), 'newly exempt outlet admitted');
  assert(used.B === 1800, 'Flag change does not reset the accounting counter');
  flags.B = false;
  const stopsBefore = calls.filter(call => call.path === '/api/outlets/B/usage/stop').length;
  [...timers.values()].forEach(tick => tick());
  await until(() => blocked()?.textContent?.includes('Daily limit reached'), 'heartbeat exhaustion shows lockout');
  await until(() => calls.filter(call => call.path === '/api/outlets/B/usage/stop').length > stopsBefore, 'automatic lease release');
  await pause();
  assert(calls.filter(call => call.path === '/api/outlets/B/usage/stop').length === stopsBefore + 1, 'Heartbeat exhaustion releases the lease exactly once');
  assert(!localStorage.getItem('pos_user_session') && !localStorage.getItem('pos_selected_outlet') && document.querySelector<HTMLButtonElement>('.outlet-lockout-resume')!.disabled && used.B === 1800, 'Restricted heartbeat exhaustion automatically logs out without resetting usage');
  root.unmount(); document.getElementById('test-results')!.textContent = JSON.stringify({ passed });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ passed, failed: String(error) }); });
