import { PRODUCT_IMAGE_MAX_BYTES } from '../../shared/productImageLimits.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { assignProductImage } from '../src/pages/productImageAssignmentApi.ts';

const targets = [{ documentId: 'a', expectedImage: null, expectedImagePath: null, replaceExisting: false }];
const file = new File([new Uint8Array([1, 2, 3])], 'processed.webp', { type: 'image/webp' });
const image = 'a'.repeat(64) + '.webp';
test('assignment sends exact processed bytes, reviewed targets and JWT to the outlet route', async t => {
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(url, '/api/outlets/o%2F1/product-image-assignments');
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer token');
    const body = JSON.parse(String(init.body));
    assert.deepEqual(body.targets, targets); assert.equal(body.contentType, file.type); assert.equal(body.requestId, 'operation');
    assert.deepEqual(Buffer.from(body.base64, 'base64'), Buffer.from(await file.arrayBuffer()));
    return Response.json({ success: true, data: { image, results: [{ documentId: 'a', status: 'saved', message: 'Saved' }] } });
  });
  assert.equal((await assignProductImage('o/1', 'token', 'operation', file, targets)).image, image);
});

test('oversized output is rejected before any request; partial failures are returned accurately', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json({ success: true, data: { image,
    results: [{ documentId: 'a', status: 'failed', message: 'Conflict' }] } }); });
  await assert.rejects(assignProductImage('o', 'token', 'id', new File([new Uint8Array(PRODUCT_IMAGE_MAX_BYTES + 1)], 'large.png'), targets), /512 KB/);
  assert.equal(calls, 0);
  assert.equal((await assignProductImage('o', 'token', 'id', file, targets)).results[0]!.status, 'failed');
});

test('expired sessions and incomplete, foreign, duplicated or malformed results cannot report success', async t => {
  const valid = { documentId: 'a', status: 'saved', message: 'Saved' };
  for (const results of [[], [{ ...valid, documentId: 'foreign' }], [valid, valid], [null], [{ ...valid, status: 'unknown' }]]) {
    const mock = t.mock.method(globalThis, 'fetch', async () => Response.json({ success: true, data: { image, results } }));
    await assert.rejects(assignProductImage('o', 'token', 'id', file, targets), /could not be confirmed/); mock.mock.restore();
  }
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 401 }));
  await assert.rejects(assignProductImage('o', 'token', 'id', file, targets), { status: 401 });
});
