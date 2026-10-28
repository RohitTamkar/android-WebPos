import assert from 'node:assert/strict';
import test from 'node:test';
import { cachedImagePreview, loadImagePreview, rememberImagePreview } from '../src/pages/imagePreviewLoader.ts';

const image = () => new Blob(['image bytes'], { type: 'image/png' });

test('only four background requests run at once; cancelled queued previews never fetch', async t => {
  const releases: (() => void)[] = [];
  const calls: RequestInit[] = [];
  t.mock.method(globalThis, 'fetch', (_url: string, init: RequestInit) => {
    calls.push(init);
    return new Promise<Response>(resolve => releases.push(() => resolve(new Response(image()))));
  });
  const controllers = Array.from({ length: 8 }, () => new AbortController());
  const requests = controllers.map((controller, i) => loadImagePreview(`/image/${i}`, 'ref', 'queue-session', controller.signal));
  const results = Promise.allSettled(requests);
  assert.equal(calls.length, 4);
  controllers[4]!.abort();
  releases.splice(0).forEach(release => release()); await Promise.all(requests.slice(0, 4));
  assert.equal(calls.length, 7);
  releases.splice(0).forEach(release => release());
  assert.equal((await results).filter(result => result.status === 'rejected').length, 1);
  assert.ok(calls.every(call => call.priority === 'low'));
  assert.ok(calls.every(call => new Headers(call.headers).get('Authorization') === 'Bearer queue-session'));
});

test('recent previews and verified uploads reuse bytes; changed references, records and sessions fetch afresh', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response(image()); });
  const signal = new AbortController().signal;
  await loadImagePreview('/p/image', 'old.png', 'cache-session', signal);
  await loadImagePreview('/p/image', 'old.png', 'cache-session', signal);
  assert.equal(calls, 1);
  rememberImagePreview('/p/image', 'uploaded.png', 'cache-session', image());
  await loadImagePreview('/p/image', 'uploaded.png', 'cache-session', signal);
  assert.equal(calls, 1, 'Returning to Products uses the verified processed upload');
  await loadImagePreview('/p/image', 'new.png', 'cache-session', signal);
  await loadImagePreview('/other/image', 'new.png', 'cache-session', signal);
  await loadImagePreview('/p/image', 'new.png', 'different-session', signal);
  assert.equal(calls, 4);
});

test('expired and oversized cache entries are discarded; authorization failures are never cached', async t => {
  const start = Date.now();
  rememberImagePreview('/p/image', 'ref', 'expiry-session', image());
  t.mock.method(Date, 'now', () => start + 10 * 60_000 + 1_000);
  assert.equal(cachedImagePreview('/p/image', 'ref', 'expiry-session'), undefined);
  rememberImagePreview('/large/image', 'ref', 'expiry-session', new Blob([new Uint8Array(7 * 1024 * 1024)], { type: 'image/png' }));
  assert.equal(cachedImagePreview('/large/image', 'ref', 'expiry-session'), undefined);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response('', { status: 401 }); });
  for (let i = 0; i < 2; i++) await assert.rejects(loadImagePreview('/p/image', 'ref', 'expiry-session', new AbortController().signal), { status: 401 });
  assert.equal(calls, 2);
});
