import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadProductList, ProductListRequestError } from '../src/pages/productListApi.ts';

const url = '/api/outlets/outlet/products';
const success = () => Response.json({ success: true, data: [{ documentId: 'existing', fields: { code: 50 } }] });

test('valid lists, including empty outlets, load once and preserve authorization', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (path: string, options: RequestInit) => {
    assert.equal(path, url); assert.deepEqual(options.headers, { Authorization: 'Bearer token' });
    assert.equal(options.method, undefined, 'GET only'); calls++; return success();
  });
  const result = await loadProductList(url, 'token', new AbortController().signal, 'products');
  assert.deepEqual(result, [{ documentId: 'existing', fields: { code: 50 } }]); assert.equal(calls, 1);
});

test('empty 500/502, empty 200 and HTML error responses recover on one read-only retry', async t => {
  for (const response of [new Response('', { status: 500 }), new Response('', { status: 502 }), new Response(''), new Response('<html>Unavailable</html>', { status: 503 })]) {
    let calls = 0;
    const mock = t.mock.method(globalThis, 'fetch', async () => ++calls === 1 ? response : success());
    const result = await loadProductList(url, 'token', new AbortController().signal, 'products');
    assert.equal(result.length, 1); assert.equal(calls, 2); mock.mock.restore();
  }
});

test('persistent empty or invalid JSON fails with a clear message after two attempts', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response('{', { status: 502 }); });
  await assert.rejects(loadProductList(url, 'token', new AbortController().signal, 'products'), error =>
    error instanceof ProductListRequestError && error.message === 'Unable to load products right now. Please try again.');
  assert.equal(calls, 2);
});

test('network interruptions recover once; persistent network failures show a useful message', async t => {
  let calls = 0;
  const mock = t.mock.method(globalThis, 'fetch', async () => { if (++calls === 1) throw new TypeError('Failed to fetch'); return success(); });
  assert.equal((await loadProductList(url, 'token', new AbortController().signal, 'products')).length, 1);
  assert.equal(calls, 2); mock.mock.restore();
  calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; throw new TypeError('Failed to fetch'); });
  await assert.rejects(loadProductList(url, 'token', new AbortController().signal, 'products'), /Unable to load products right now/);
  assert.equal(calls, 2);
});

test('401, 403 and valid application errors preserve status and are not retried', async t => {
  for (const status of [401, 403, 422]) {
    let calls = 0;
    const mock = t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json({ success: false, message: 'Access denied.' }, { status }); });
    await assert.rejects(loadProductList(url, 'token', new AbortController().signal, 'products'), error => error instanceof ProductListRequestError && error.status === status);
    assert.equal(calls, 1); mock.mock.restore();
  }
});

test('abort during retry cancels the retry without another request', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response('', { status: 500 }); });
  const controller = new AbortController();
  const pending = loadProductList(url, 'token', controller.signal, 'products');
  setTimeout(() => controller.abort(), 20);
  await assert.rejects(pending, error => error instanceof DOMException && error.name === 'AbortError');
  assert.equal(calls, 1);
});

test('category requests recover independently and valid empty data is not an error', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => ++calls === 1 ? new Response('', { status: 500 }) : Response.json({ success: true, data: [] }));
  assert.deepEqual(await loadProductList('/api/outlets/outlet/categories', 'token', new AbortController().signal, 'categories'), []);
  assert.equal(calls, 2);
});
