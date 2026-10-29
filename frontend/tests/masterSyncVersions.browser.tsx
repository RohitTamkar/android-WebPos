import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { CustomersPage } from '../src/pages/CustomersPage.tsx';
import '../src/index.css';

const checks: string[] = [];
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); checks.push(message); };
const pause = (ms = 20) => new Promise(resolve => setTimeout(resolve, ms));
async function until(check: () => unknown) { for (let i = 0; i < 250; i++) { if (check()) return; await pause(); } throw new Error('Timed out'); }
const encoder = new TextEncoder();
let feed: ReadableStreamDefaultController<Uint8Array> | null = null, connections = 0, reads = 0;
// What the server reports when a connection opens; null sends the older unversioned notice.
let version: string | null = null;
const customer = (name: string) => ({ documentId: 'c1', name, contact: '', altContact: '', email: '', gstNo: '', address: '', creditLimit: 0, dayLimit: 0, balance: 0, birthdayDate: '', anniversaryDate: '', allowedCredit: false });
let customers = [customer('Original customer')];
window.fetch = async (input, init) => {
  const url = new URL(String(input), location.href);
  if (url.pathname.endsWith('/master-sync')) {
    connections++;
    return new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        feed = controller;
        controller.enqueue(encoder.encode(`${JSON.stringify(version ? { type: 'changed', collection: 'CUSTOMER', version } : { type: 'changed' })}\n`));
        init?.signal?.addEventListener('abort', () => { try { controller.close(); } catch { /* already closed */ } }, { once: true });
      },
    }), { headers: { 'Content-Type': 'application/x-ndjson' } });
  }
  if (url.pathname.endsWith('/customers')) { reads++; return Response.json({ success: true, data: { customers } }); }
  throw new Error(`Unexpected request: ${url.pathname}`);
};
const rows = () => document.querySelector('tbody')?.textContent ?? '';
// The server ends each connection (bounded hosts); the page reconnects by itself.
async function rotate() {
  const before = connections; feed!.close(); feed = null;
  await until(() => connections > before && feed); await pause(450);
}
const root = createRoot(document.getElementById('root')!);
void (async () => {
  flushSync(() => root.render(<CustomersPage outlet={{ id: 'outlet', name: 'Outlet', active: true }} token="token" onSessionExpired={() => { throw new Error('Unexpected expiry'); }} />));
  await until(() => feed && rows().includes('Original customer')); await pause(700);

  const unversioned = reads; await rotate(); await rotate();
  assert(reads === unversioned + 2, 'older unversioned servers still refresh on every reconnect');

  version = 'v1'; await rotate();
  assert(reads === unversioned + 3, 'the first versioned notice reconciles the list once');
  const settled = reads; await rotate(); await rotate(); await rotate();
  assert(reads === settled, 'reconnects reporting an unchanged version download nothing');

  customers = [customer('Changed elsewhere')]; version = 'v2'; await rotate();
  await until(() => rows().includes('Changed elsewhere'));
  assert(reads === settled + 1, 'a changed version refreshes exactly once and shows the change');

  feed!.enqueue(encoder.encode('{"type":"changed","collection":"CUSTOMER","version":"v3"}\n'));
  customers = [customer('Live change')];
  await until(() => rows().includes('Live change'));
  assert(reads === settled + 2, 'live notices on an open connection still refresh');
  root.unmount();
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, checks, reads, connections });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), checks, reads, connections }); });
