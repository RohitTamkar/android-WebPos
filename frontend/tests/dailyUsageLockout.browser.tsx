import { createRoot } from 'react-dom/client';
import App from '../src/App.tsx';
import '../src/index.css';

const passed: string[] = [];
const assert = (ok: unknown, message: string) => { if (!ok) throw new Error(message); passed.push(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 20));
async function until(check: () => unknown, label: string) { for (let i = 0; i < 150; i++) { if (check()) return; await pause(); } throw new Error(`Timeout: ${label}`); }
const outlet = { id: 'outlet', name: 'OTP', branch: 'Vivek Vihar', active: true, country: '' };
const user = { id: 'u', name: 'Software Team', email: 'test@example.com', role: 'Admin', terminal: 'POS', token: 'token' };
let denied = false;
const calls: string[] = [];
window.fetch = async (input, init) => {
  const path = String(input); calls.push(path);
  if (path === '/api/auth/outlets') return Response.json({ success: true, data: { outlets: [outlet] } });
  if (path.includes('/usage/')) return Response.json({ success: true, data: {
    outletId: 'outlet', sessionId: 'session', generation: 'generation', sequence: init?.body ? JSON.parse(String(init.body)).sequence ?? 0 : 0,
    dailyLimitApplies: true, usedSeconds: 120, remainingSeconds: 1680, date: '2026-10-28', timeZone: 'Asia/Kolkata',
  } });
  if (denied) return Response.json({ success: false, code: 'USAGE_SESSION_EXPIRED', message: 'Web POS usage paused. Continue when you are ready.' }, { status: 428 });
  return Response.json({ success: true, data: path.includes('/dashboard?') ? { payments: {}, shifts: [] } : [] });
};
localStorage.clear(); sessionStorage.clear();
localStorage.setItem('pos_user_session', JSON.stringify(user)); localStorage.setItem('pos_selected_outlet', JSON.stringify(outlet));
const root = createRoot(document.getElementById('root')!);
document.getElementById('test-results')!.style.display = 'none';
const overlay = () => document.querySelector<HTMLDialogElement>('.outlet-lockout[open]');
const lock = async () => { denied = true; await fetch('/api/outlets/outlet/products'); await until(overlay, 'full-screen lockout'); };
void (async () => {
  root.render(<App />); await until(() => document.querySelector('.dashboard-columns') && !overlay(), 'authorized dashboard');
  const workspace = document.querySelector<HTMLElement>('.retail-dashboard-shell')!;
  const editor = document.createElement('dialog'); editor.textContent = 'Sensitive POS editor'; workspace.append(editor); editor.showModal();
  await lock();
  const bounds = overlay()!.getBoundingClientRect(), card = document.querySelector('.outlet-lockout-card')!.getBoundingClientRect();
  assert(bounds.left === 0 && bounds.top === 0 && bounds.width >= document.documentElement.clientWidth && bounds.height >= innerHeight, 'Lockout covers the entire viewport');
  assert(Math.abs(card.left + card.width / 2 - bounds.width / 2) < 3 && Math.abs(card.top + card.height / 2 - bounds.height / 2) < 3, 'Pause card is centered');
  assert(workspace.inert && workspace.getAttribute('aria-hidden') === 'true' && getComputedStyle(workspace).visibility === 'hidden', 'POS workspace is hidden, inert and removed from accessibility navigation');
  assert(document.body.style.overflow === 'hidden' && document.documentElement.style.overflow === 'hidden', 'Underlying workspace scrollbars and scrolling are locked');
  assert(getComputedStyle(editor).visibility === 'hidden', 'An already open POS dialog is also obscured');
  const completedSave = document.createElement('dialog'); completedSave.textContent = 'Sensitive save result'; workspace.append(completedSave); completedSave.showModal(); await pause();
  assert(getComputedStyle(completedSave).visibility === 'hidden' && overlay()!.contains(document.activeElement), 'A save completing during pause cannot cover the lockout or reveal its result');
  assert(overlay()!.contains(document.activeElement), 'Focus is inside the lockout dialog');
  const escape = new Event('cancel', { cancelable: true }); overlay()!.dispatchEvent(escape);
  assert(escape.defaultPrevented && overlay()!.open, 'Escape cannot bypass lockout');
  assert(overlay()!.textContent!.includes('OTP') && overlay()!.textContent!.includes('Vivek Vihar') && overlay()!.textContent!.includes('Software Team'), 'Card displays outlet, location and user context');
  assert(overlay()!.querySelectorAll('button').length === 3, 'Card provides Resume, Change Outlet and Sign Out');
  if (location.hash === '#preview') { document.getElementById('test-results')!.textContent = JSON.stringify({ passed }); return; }
  denied = false; document.querySelector<HTMLButtonElement>('.outlet-lockout-resume')!.click(); await until(() => !overlay(), 'resume');
  assert(editor.open && getComputedStyle(editor).visibility === 'visible' && !workspace.inert, 'Resume restores the original mounted editor after backend admission');
  assert(document.body.style.overflow !== 'hidden' && document.documentElement.style.overflow !== 'hidden', 'Resume restores the original page scrolling');
  completedSave.close(); completedSave.remove(); editor.close(); editor.remove();
  await lock(); document.querySelector<HTMLButtonElement>('.outlet-lockout-change')!.click();
  await until(() => document.querySelector('.outlet-card button'), 'authorized outlet picker');
  assert(!!localStorage.getItem('pos_user_session') && !localStorage.getItem('pos_selected_outlet'), 'Change Outlet releases the selection and preserves authentication');
  denied = false; document.querySelector<HTMLButtonElement>('.outlet-card button')!.click(); await until(() => !overlay() && document.querySelector('.dashboard-columns'), 'outlet re-admitted');
  localStorage.setItem('pos_selected_outlet', JSON.stringify({ ...outlet, id: 'other-outlet' }));
  window.dispatchEvent(new StorageEvent('storage', { key: 'pos_selected_outlet', storageArea: localStorage }));
  await until(() => overlay()?.textContent?.includes('Your outlet changed'), 'cross-tab outlet change');
  assert(document.querySelector('.retail-dashboard-shell')!.getAttribute('aria-hidden') === 'true', 'Changing outlets elsewhere obscures the old outlet immediately');
  document.querySelector<HTMLButtonElement>('.outlet-lockout-change')!.click();
  await until(() => document.querySelector('.outlet-card button'), 'picker after external outlet change');
  assert(JSON.parse(localStorage.getItem('pos_selected_outlet')!).id === 'other-outlet' && !!localStorage.getItem('pos_user_session'), 'Recovery preserves the other tab’s selection and the valid account');
  document.querySelector<HTMLButtonElement>('.outlet-card button')!.click(); await until(() => !overlay() && document.querySelector('.dashboard-columns'), 'selected outlet re-admitted');
  const stops = calls.filter(path => path.endsWith('/usage/stop')).length;
  localStorage.removeItem('pos_user_session');
  window.dispatchEvent(new StorageEvent('storage', { key: 'pos_user_session', newValue: null, storageArea: localStorage }));
  await until(() => overlay()?.textContent?.includes('another tab'), 'cross-tab logout lockout');
  await until(() => calls.filter(path => path.endsWith('/usage/stop')).length > stops, 'invalidated lease release');
  const response = await fetch('/api/outlets/outlet/products');
  assert(response.status === 428, 'Cross-tab invalidation prevents protected requests');
  document.querySelector<HTMLButtonElement>('.outlet-lockout-resume')!.click(); await until(() => document.getElementById('crm-email'), 'sign-in after external logout');
  assert(!localStorage.getItem('pos_user_session'), 'Resume cannot reuse authentication removed by another tab');
  root.unmount(); document.getElementById('test-results')!.textContent = JSON.stringify({ passed });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ passed, failed: String(error) }); });
