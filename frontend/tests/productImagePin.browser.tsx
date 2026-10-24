import { createRoot } from 'react-dom/client';
import { ProductsPage } from '../src/pages/ProductsPage.tsx';
import type { OutletSummary } from '../src/pages/OutletSelectionPage.tsx';

void (async () => {
  const passed: string[] = [];
  const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
  const pause = () => new Promise(resolve => setTimeout(resolve, 20));
  const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === label)!;
  const wait = async (check: () => unknown) => { for (let i = 0; i < 150; i++) { if (check()) return; await pause(); } throw new Error(`Timeout: ${document.body.textContent}`); };
  let verifications = 0, mutations = 0, logouts = 0, status = 200;
  let release: (() => void) | undefined;
  let hold = false;
  window.fetch = async (url, init) => {
    const path = String(url);
    if (path.endsWith('/verify-quick-pin')) {
      assert(init?.priority === 'high', 'PIN verification has foreground priority');
      verifications++;
      const body = JSON.parse(String(init?.body));
      if (hold) await new Promise<void>(resolve => { release = resolve; });
      if (status !== 200) return Response.json({ success: false, message: 'Access denied' }, { status });
      return body.quickPin === '1234'
        ? Response.json({ success: true, data: { verified: true, action: body.action, imageToken: 'scoped-grant' } })
        : Response.json({ success: false, message: 'Incorrect Quick PIN' }, { status: 422 });
    }
    if (init?.method && init.method !== 'GET') { mutations++; throw new Error('Unexpected mutation before confirmation'); }
    if (path.endsWith('/products')) return Response.json({ success: true, data: [{ documentId: 'p', fields: { name: 'Tea', image: 'old.png' } }] });
    if (path.endsWith('/categories')) return Response.json({ success: true, data: [] });
    return new Response(new Blob());
  };
  const root = createRoot(document.getElementById('root')!);
  const render = (token: string) => root.render(<ProductsPage outlet={{ id: 'o', name: 'Outlet' } as OutletSummary} token={token} onSessionExpired={() => { logouts++; }} />);
  const open = async (label: string) => {
    document.querySelector<HTMLButtonElement>('[aria-label="Product image options"]')!.click();
    await wait(() => button(label)); button(label).click();
    await wait(() => document.querySelector('#image-quick-pin'));
  };
  const enter = async (pin: string) => {
    const input = document.querySelector<HTMLInputElement>('#image-quick-pin')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, pin);
    input.dispatchEvent(new Event('input', { bubbles: true })); await pause();
  };
  const submit = () => document.querySelector('dialog form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  try {
    for (const [action, label] of Object.entries({ bulk: 'Bulk Upload Images', shared: 'One Image for Multiple Products', remove: 'Remove all product images' })) {
      render(action); await pause(); await wait(() => document.querySelector('section[aria-busy="false"]'));
      await open(label);
      const before = verifications;
      const pinInput = document.querySelector<HTMLInputElement>('#image-quick-pin')!;
      assert(pinInput.maxLength === 4 && pinInput.minLength === 4 && pinInput.pattern === '[0-9]{4}', `${action}: exactly four login PIN digits required`);
      await enter('123'); assert(button('Verify').disabled, `${action}: three digits rejected`);
      await enter('');
      assert(button('Verify').disabled, `${action}: empty PIN disabled`); submit(); await pause();
      assert(verifications === before && mutations === 0, `${action}: empty PIN rejected`);
      await enter('9999'); submit(); await wait(() => document.querySelector('[role="alert"]')?.textContent === 'Incorrect Quick PIN');
      assert(!document.querySelector('.product-image-batch') && !button('Confirm remove all images') && mutations === 0, `${action}: wrong PIN blocks action`);
      assert((document.querySelector('#image-quick-pin') as HTMLInputElement).value === '', 'PIN cleared after request');
      button('Cancel').click(); await wait(() => !document.querySelector('dialog'));
      await open(label); await enter('1234'); hold = true;
      const count = verifications; submit(); submit(); await wait(() => verifications > count);
      assert(verifications === count + 1, `${action}: repeated submissions verify once`);
      button('Cancel').click(); await wait(() => !document.querySelector('dialog')); release!(); await pause(); hold = false;
      assert(!document.querySelector('.product-image-batch') && !button('Confirm remove all images'), `${action}: cancelled request cannot open workflow`);
      for (const denied of [401, 403]) {
        status = denied; await open(label); await enter('1234'); submit();
        await wait(() => denied === 401 ? logouts > 0 : document.querySelector('[role="alert"]')?.textContent === 'Access denied');
        assert(!document.querySelector('.product-image-batch') && !button('Confirm remove all images'), `${action}: unauthorized user blocked`);
        button('Cancel').click(); await wait(() => !document.querySelector('dialog')); logouts = 0;
      }
      status = 200; await open(label); await enter('1234'); submit();
      await wait(() => action === 'remove' ? button('Confirm remove all images') : document.querySelector('.product-image-batch'));
      assert(mutations === 0, `${action}: correct PIN opens intended workflow before mutations`);
      if (action === 'remove') button('Cancel').click(); else button('Back to Products').click();
      await wait(() => document.querySelector('section[aria-label="Products"]'));
      await open(label); assert(document.querySelector('#image-quick-pin'), `${action}: reentry asks again`);
      button('Cancel').click(); await wait(() => !document.querySelector('dialog'));
      passed.push(`${label}: correct, incorrect, empty, cancel, cancel in flight, repeated submit, unauthorized, expired session, fresh PIN on reentry`);
    }
    root.unmount(); document.getElementById('test-results')!.textContent = JSON.stringify({ passed, mutations });
  } catch (error) { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), passed }); }
})();
