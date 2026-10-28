import { createRoot } from 'react-dom/client';
import App from '../src/App.tsx';
import '../src/index.css';

const passed: string[] = [];
const assert = (ok: unknown, message: string) => { if (!ok) throw new Error(message); passed.push(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 20));
async function until(check: () => unknown, label: string) {
  for (let i = 0; i < 150; i++) { if (check()) return; await pause(); }
  throw new Error(`Timeout: ${label}`);
}
window.fetch = async input => {
  const path = String(input);
  if (path.includes('/dashboard?')) return Response.json({ success: true, data: { payments: {}, shifts: [] } });
  if (path.endsWith('/products') || path.endsWith('/categories')) return Response.json({ success: true, data: [] });
  throw new Error(`Unexpected API: ${path}`);
};
localStorage.clear(); sessionStorage.clear(); history.replaceState(null, '');
localStorage.setItem('pos_user_session', JSON.stringify({ id: 'u', name: 'User', email: 'u@example.com', role: 'Admin', terminal: 'POS', token: 'mock-token' }));
localStorage.setItem('pos_selected_outlet', JSON.stringify({ id: 'outlet', name: 'Outlet', active: true, branch: '', country: '' }));
let root = createRoot(document.getElementById('root')!);
const nav = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('.nav-group-items button')].find(button => button.textContent?.trim() === label)!;
const upload = () => document.querySelector('.upload-excel-page');
const instructions = () => document.querySelector('dialog[open] .excel-sheet-instructions');
const option = (title: string) => [...document.querySelectorAll<HTMLButtonElement>('.upload-excel-option')].find(button => button.textContent?.includes(title))!;
void (async () => {
  const url = location.href;
  root.render(<App />);
  await until(() => document.querySelector('.dashboard-columns'), 'dashboard');
  nav('Products').click(); await until(() => document.querySelector('.products-page-shell'), 'products');
  const length = history.length; nav('Products').click(); await pause();
  assert(history.length === length, 'Repeated navigation to the same screen adds no duplicate history entry');
  [...document.querySelectorAll<HTMLElement>('.nav-group-title')].find(node => node.textContent?.includes('Operations'))!.click(); await pause();
  nav('Upload Excel').click(); await until(upload, 'upload screen');
  assert(!document.querySelector('.upload-excel-page details'), 'Templates are removed from the upload landing screen');
  option('Excel Sheet Instructions').click(); await until(instructions, 'instructions');
  assert(instructions()!.querySelectorAll('.csv-upload-file-controls button').length === 2, 'Both template downloads are inside Excel Sheet Instructions');
  history.back(); await until(() => upload() && !instructions(), 'back closes instructions');
  assert(!!upload(), 'Browser Back closes the dialog and keeps the upload screen');
  history.back(); await until(() => document.querySelector('.products-page-shell'), 'back returns to products');
  assert(!upload(), 'Browser Back restores the previous app screen');
  history.forward(); await until(upload, 'forward to upload');
  history.forward(); await until(instructions, 'forward to instructions');
  assert(!!instructions(), 'Browser Forward restores the upload screen and instruction dialog');
  document.querySelector<HTMLButtonElement>('[aria-label="Close information"]')!.click();
  await until(() => upload() && !instructions(), 'close uses prior upload entry');
  root.unmount(); root = createRoot(document.getElementById('root')!); root.render(<App />);
  await until(upload, 'restored browser entry');
  assert(!!upload() && !instructions(), 'Remount restores the current screen without reopening a closed dialog');
  assert(location.href === url, 'Internal Back and Forward keep the application URL');
  document.querySelector<HTMLButtonElement>('.sidebar-logout')!.click(); await pause();
  document.querySelector<HTMLButtonElement>('.confirm')!.click(); await until(() => document.getElementById('crm-email'), 'logout');
  history.back(); await pause();
  assert(!!document.getElementById('crm-email') && !localStorage.getItem('pos_user_session'), 'Browser history cannot restore authentication after logout');
  root.unmount(); document.getElementById('test-results')!.textContent = JSON.stringify({ passed });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ passed, failed: String(error) }); });
