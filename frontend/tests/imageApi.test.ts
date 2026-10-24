import assert from 'node:assert/strict';
import { test } from 'node:test';
import { masterImageUrl, productImageReference, removeMasterImage, uploadMasterImage } from '../src/pages/imageApi.ts';

test('product display uses image first and imagePath only as a legacy fallback', () => {
  assert.equal(productImageReference({ image: '1000014014.png' }), '1000014014.png');
  assert.equal(productImageReference({ image: '1000014014.png', imagePath: 'saved/web/path' }), '1000014014.png');
  assert.equal(productImageReference({ image: '1000014014.png', imagePath: null }), '1000014014.png');
  for (const image of [null, '']) {
    assert.equal(productImageReference({ image }), undefined);
  }
  assert.equal(productImageReference({ image: 'sensible_images/OUTLET/o/PRODUCT_IMAGES/p/abc.png' }), 'sensible_images/OUTLET/o/PRODUCT_IMAGES/p/abc.png');
  assert.equal(productImageReference({ imagePath: 'legacy/path' }), 'legacy/path');
  assert.equal(productImageReference(undefined), undefined);
  assert.equal(productImageReference({}), undefined);
});

test('image upload and removal use authenticated record routes without caller-selected Storage paths', async t => {
  const calls: { url: string; init: RequestInit }[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Response.json({ success: true, data: init.method === 'PUT' ? { image: 'verified-image.png' } : { removed: true } });
  });
  const file = new File(['mock bytes'], 'local.png', { type: 'image/png' });
  assert.equal(await uploadMasterImage('outlet', 'products', 'product', 'token', file), 'verified-image.png');
  await removeMasterImage('outlet', 'products', 'product', 'token');
  for (const { url, init } of calls) {
    assert.equal(url, '/api/outlets/outlet/products/product/image');
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer token');
  }
  assert.equal(calls[0]!.init.body, file); assert.equal(calls[1]!.init.method, 'DELETE');
  assert.equal(masterImageUrl('outlet/id', 'products', 'product/id'), '/api/outlets/outlet%2Fid/products/product%2Fid/image');
});

test('upload failures, missing references and expired sessions never return a saved reference', async t => {
  for (const response of [
    Response.json({ success: false, message: 'Upload verification failed' }, { status: 503 }),
    Response.json({ success: true, data: {} }),
    new Response('', { status: 401 }),
  ]) {
    const mock = t.mock.method(globalThis, 'fetch', async () => response);
    await assert.rejects(uploadMasterImage('outlet', 'products', 'product', 'token', new File(['bytes'], 'a.png', { type: 'image/png' })));
    mock.mock.restore();
  }
});

 test('oversized product files are rejected before sending a request', async t => {
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => { requests++; return Response.json({}); });
  await assert.rejects(uploadMasterImage('o', 'products', 'p', 'token', new File([new Uint8Array(30 * 1024 + 1)], 'large.png', { type: 'image/png' })), /30 KB/);
  assert.equal(requests, 0);
});

test('single-product retries preserve the operation ID, reviewed reference and exact file bytes', async t => {
  const calls: RequestInit[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    calls.push(init); return calls.length === 1
      ? Response.json({ success: false, message: 'Uncertain save' }, { status: 503 })
      : Response.json({ success: true, data: { image: 'verified.png' } });
  });
  const file = new File(['bytes'], 'new.png', { type: 'image/png' });
  await assert.rejects(uploadMasterImage('o', 'products', 'p', 'token', file, 'old.png'));
  await uploadMasterImage('o', 'products', 'p', 'token', file, 'different.png');
  const first = new Headers(calls[0]!.headers), second = new Headers(calls[1]!.headers);
  assert.match(first.get('X-Image-Upload-Id')!, /^[a-f0-9-]{36}$/i);
  assert.equal(first.get('X-Image-Upload-Id'), second.get('X-Image-Upload-Id'));
  assert.equal(second.get('X-Image-Expected-Reference'), '"old.png"');
  assert.equal(calls[0]!.body, file); assert.equal(calls[1]!.body, file);
});

test('reviewed removal sends confirmed references and the PIN grant to the protected bulk route', async t => {
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(url, '/api/outlets/o/product-image-removals/p'); assert.equal(init.method, 'DELETE');
    assert.equal(new Headers(init.headers).get('X-Image-Token'), 'image-grant');
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer token');
    assert.deepEqual(JSON.parse(String(init.body)), { image: 'shared.png', imagePath: 'legacy/path' });
    return Response.json({ success: true, data: { removed: true } });
  });
  await removeMasterImage('o', 'products', 'p', 'token', { image: 'shared.png', imagePath: 'legacy/path' }, 'image-grant');
});
