import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequestId } from '../src/utils/requestId.ts';

const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('uses native UUID generation when available', () => {
  const expected = '12345678-1234-4234-8234-123456789abc';
  assert.equal(createRequestId({ randomUUID: () => expected }), expected);
});

test('LAN HTTP fallback produces valid, distinct UUIDs using secure random bytes', () => {
  const insecureContextCrypto = { getRandomValues: bytes => globalThis.crypto.getRandomValues(bytes) };
  const ids = Array.from({ length: 100 }, () => createRequestId(insecureContextCrypto));
  assert.ok(ids.every(id => uuidV4.test(id)));
  assert.equal(new Set(ids).size, ids.length);
});

test('fallback sets version and variant bits correctly at byte boundaries', () => {
  assert.equal(createRequestId({ getRandomValues: bytes => bytes.fill(255) }), 'ffffffff-ffff-4fff-bfff-ffffffffffff');
  assert.equal(createRequestId({ getRandomValues: bytes => bytes.fill(0) }), '00000000-0000-4000-8000-000000000000');
});
