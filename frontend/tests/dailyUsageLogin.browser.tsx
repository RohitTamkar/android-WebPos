// Real login, outlet picker and usage hook; API responses are isolated mocks.
import { createRoot } from 'react-dom/client';
import App from '../src/App.tsx';
import { DAILY_WEB_USAGE_ENABLED } from '../../shared/webUsageFeature.ts';
import '../src/index.css';

const passed: string[] = [];
const assert = (ok: unknown, message: string) => { if (!ok) throw new Error(message); passed.push(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 20));
async function until(check: () => unknown, label: string) {
  for (let i = 0; i < 150; i++) { if (check()) return; await pause(); }
  throw new Error(`Timeout: ${label}`);
}
const user = { id: 'user', email: 'user@example.com', name: 'User', role: 'Admin', terminal: 'POS' };
const outlets = ['limited', 'exempt'].map(id => ({ id, name: id, branch: '', country: '', active: true }));
const used: Record<string, number> = { limited: 450, exempt: 1800 };
const calls: string[] = [];
let allowLogin = false;
let admit: (() => void) | undefined;
let deferAdmission = true;
const exhausted = () => Response.json({ success: false, code: 'USAGE_LIMIT_REACHED', message: 'Daily allowance exhausted.' }, { status: 403 });
window.fetch = async (input, init) => {
  const path = String(input), headers = new Headers(init?.headers);
  calls.push(path);
  if (path === '/api/auth/login') {
    return allowLogin ? Response.json({ success: true, data: { user, token: 'token' } })
      : Response.json({ success: false, message: 'Invalid credentials' }, { status: 401 });
  }
  if (headers.get('Authorization') !== 'Bearer token') throw new Error('Missing authentication');
  if (path === '/api/auth/outlets') return Response.json({ success: true, data: { outlets } });
  const match = path.match(/^\/api\/outlets\/(limited|exempt)\/(.*)$/);
  if (!match) throw new Error(`Unexpected route: ${path}`);
  const [, id, action] = match as [string, string, string];
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  if (action === 'usage/start' && deferAdmission) await new Promise<void>(resolve => { admit = resolve; });
  if (action !== 'usage/stop' && id === 'limited' && used[id]! >= 1800) return exhausted();
  if (action.startsWith('usage/')) return Response.json({ success: true, data: {
    outletId: id, sessionId: `session-${id}`, generation: 'same-day', sequence: body.sequence ?? 0,
    dailyLimitApplies: id === 'limited', usedSeconds: used[id], remainingSeconds: Math.max(0, 1800 - used[id]!), date: '2026-10-28', timeZone: 'Asia/Kolkata',
  } });
  if (!headers.get('X-Web-Usage-Session')) throw new Error('Protected request before admission');
  return Response.json({ success: true, data: action.includes('dashboard?') ? { payments: {}, shifts: [] } : [] });
};
localStorage.clear(); sessionStorage.clear();
let root = createRoot(document.getElementById('root')!);
const notice = () => document.querySelector('[data-outlet-access-notice]');
const usageCalls = () => calls.filter(path => path.includes('/usage/'));
const input = (id: string, value: string) => {
  const element = document.getElementById(id)!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
};
const signIn = async () => {
  await until(() => document.getElementById('crm-email'), 'login form');
  input('crm-email', user.email); input('crm-quick-pin', '1234'); await pause();
  document.querySelector<HTMLFormElement>('.crm-password-form')!.requestSubmit();
};
const choose = async (index: number) => {
  await until(() => document.querySelectorAll('.outlet-card button').length === 2, 'authorized outlets');
  document.querySelectorAll<HTMLButtonElement>('.outlet-card button')[index]!.click();
};
const remount = async () => {
  root.unmount(); await pause(); root = createRoot(document.getElementById('root')!); root.render(<App />);
};
void (async () => {
  assert(DAILY_WEB_USAGE_ENABLED === true, 'Global usage switch remains enabled');
  root.render(<App />); await signIn();
  await until(() => document.querySelector('.crm-form-error'), 'failed authentication');
  assert(usageCalls().length === 0, 'Failed authentication creates no usage lease');
  allowLogin = true; await signIn();
  await until(() => document.querySelectorAll('.outlet-card button').length === 2, 'outlet selection');
  assert(usageCalls().length === 0, 'Successful login alone does not start an outlet timer');
  await choose(0); await until(() => admit, 'pending admission');
  assert(!document.querySelector('.dashboard-columns'), 'Workspace waits for backend outlet admission');
  assert(!calls.some(path => path.includes('/limited/') && !path.includes('/usage/')), 'No protected request runs before admission');
  deferAdmission = false; admit!();
  await until(() => document.querySelector('.dashboard-columns') && !notice(), 'limited outlet admitted');
  assert(used.limited === 450, 'Authorized lease starts without resetting existing daily usage');
  const starts = usageCalls().filter(path => path.endsWith('/start')).length;
  await remount();
  await until(() => usageCalls().filter(path => path.endsWith('/start')).length > starts && document.querySelector('.dashboard-columns') && !notice(), 'refresh admission');
  assert(used.limited === 450, 'Page refresh reacquires a lease without resetting the counter');
  used.limited = 1800; // Simulate authoritative server accounting reaching the cap.
  const denied = await fetch('/api/outlets/limited/products', { headers: { Authorization: 'Bearer token' } });
  await until(() => notice()?.textContent?.includes('Daily limit reached'), 'full screen exhaustion lockout');
  await until(() => calls.some(path => path === '/api/outlets/limited/usage/stop'), 'exhausted lease release');
  assert(!localStorage.getItem('pos_user_session') && !localStorage.getItem('pos_selected_outlet') && !document.querySelector('.retail-dashboard-shell') && document.querySelector<HTMLButtonElement>('.outlet-lockout-resume')!.disabled, 'Restricted exhaustion automatically ends authentication and displays its signed-out notice');
  document.querySelector<HTMLButtonElement>('.outlet-lockout-signout')!.click();
  await until(() => document.getElementById('crm-email'), 'explicit Sign Out');
  assert(!localStorage.getItem('pos_user_session') && !localStorage.getItem('pos_selected_outlet'), 'Sign Out clears authenticated outlet state');
  assert(denied.status === 403, 'Backend exhaustion blocks the limited outlet at 1800 seconds');
  await signIn(); await choose(0);
  await until(() => notice()?.textContent?.includes('Daily limit reached'), 'exhausted relogin shows lockout');
  assert(used.limited === 1800 && !document.querySelector('.dashboard-columns'), 'Repeated login cannot reset or bypass the exhausted counter');
  document.querySelector<HTMLButtonElement>('.outlet-lockout-signout')!.click();
  await signIn(); await choose(1);
  await until(() => document.querySelector('.dashboard-columns') && !notice(), 'exempt outlet admission');
  const allowed = await fetch('/api/outlets/exempt/products', { headers: { Authorization: 'Bearer token' } });
  assert(allowed.ok && !notice() && used.exempt === 1800, 'Exempt outlet remains usable with zero daily allowance remaining');
  root.unmount(); document.getElementById('test-results')!.textContent = JSON.stringify({ passed });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ passed, failed: String(error) }); });
