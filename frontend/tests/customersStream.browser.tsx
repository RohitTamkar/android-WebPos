import { createRoot } from 'react-dom/client';
import { CustomersPage } from '../src/pages/CustomersPage.tsx';
import type { OutletSummary } from '../src/pages/OutletSelectionPage.tsx';
import '../src/index.css';
const passed: string[] = [];
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 20));
async function until(check: () => unknown, message: string) { for (let i = 0; i < 150; i++) { if (check()) return; await pause(); } throw new Error(`Timed out: ${message}`); }
const customer = (documentId: string, name: string) => ({ documentId, name, contact: '', altContact: '', email: '', gstNo: '', address: '',
  creditLimit: 0, dayLimit: 0, balance: 0, birthdayDate: '', anniversaryDate: '', allowedCredit: false });
let release!: () => void;
window.fetch = async (url, init) => {
  assert(!init?.method || init.method === 'GET', 'Loading customers never writes');
  assert(String(url) === '/api/outlets/outlet/customers', `Unexpected request: ${String(url)}`);
  assert(new Headers(init?.headers).get('Accept') === 'application/x-ndjson', 'The customer list asks for a stream');
  const encoder = new TextEncoder(), line = (value: unknown) => encoder.encode(`${JSON.stringify(value)}\n`);
  return new Response(new ReadableStream({ start(controller) {
    controller.enqueue(line({ type: 'total', total: 3 }));
    controller.enqueue(line({ type: 'items', data: [customer('c2', 'Zara'), customer('c1', 'Asha')] }));
    release = () => { controller.enqueue(line({ type: 'items', data: [customer('c3', 'Meena')] })); controller.enqueue(line({ type: 'end', count: 3 })); controller.close(); };
  } }), { headers: { 'Content-Type': 'application/x-ndjson' } });
};
const names = () => [...document.querySelectorAll('.customer-edit-button')].map(button => button.textContent);
const root = createRoot(document.getElementById('root')!);
root.render(<CustomersPage outlet={{ id: 'outlet', name: 'Outlet' } as OutletSummary} token="token" onSessionExpired={() => { throw new Error('Unexpected session expiration'); }} />);
void (async () => {
  await until(() => names().length === 2, 'first streamed customers show before the rest arrive');
  assert(JSON.stringify(names()) === JSON.stringify(['Asha', 'Zara']), 'streamed customers are sorted by name');
  passed.push('Customers appear batch by batch, sorted by name');
  release();
  await until(() => names().length === 3, 'remaining customers arrive');
  assert(JSON.stringify(names()) === JSON.stringify(['Asha', 'Meena', 'Zara']), 'later batches merge into the sorted list');
  passed.push('Later batches merge into the sorted customer list');
  root.unmount(); document.getElementById('test-results')!.textContent = JSON.stringify({ passed });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), passed }); });
