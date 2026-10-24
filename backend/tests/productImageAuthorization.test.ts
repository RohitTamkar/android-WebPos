import assert from 'node:assert/strict';
import test from 'node:test';
import type { Firestore } from 'firebase-admin/firestore';
import { verifyProductImagePin, requireProductImageAuthorization } from '../src/productImageAuthorization.js';

const secret = 'isolated-image-authorization-key-12345678';
let sequence = 0;
function fixture() {
  const id = `image-user-${++sequence}`;
  const profile: Record<string, unknown> = { active: true, quickPin: '1234', outlets: ['outlet'] };
  const db = { collection: () => ({ doc: (profileId: string) => ({ get: async () => {
    assert.equal(profileId, id); return { data: () => profile };
  } }) }) } as unknown as Firestore;
  const assigned = (value: Record<string, unknown>) => value.outlets as string[];
  return { id, profile, verify: (raw: unknown, user: string | null = id, outlet = 'outlet', key = secret) =>
    verifyProductImagePin(db, outlet, user, assigned, key, 'Bearer session', raw) };
}

for (const action of ['bulk', 'shared', 'remove']) {
  test(`${action}: correct PIN issues only an outlet/action/session scoped grant; wrong or empty PIN never does`, async () => {
    const f = fixture();
    for (const quickPin of ['', '9999', '123', '12345', '123456', '1234567', '12ab'])
      await assert.rejects(f.verify({ action, quickPin }), { status: quickPin === '9999' ? 422 : 400 });
    const result = await f.verify({ action, quickPin: '1234' });
    assert.equal(result.verified, true); assert.equal(result.action, action);
    requireProductImageAuthorization(secret, result.imageToken, f.id, 'outlet', 'Bearer session', [action]);
    for (const [grant, user, outlet, session, actions] of [
      [undefined, f.id, 'outlet', 'Bearer session', [action]],
      ['forged', f.id, 'outlet', 'Bearer session', [action]],
      [result.imageToken, 'other-user', 'outlet', 'Bearer session', [action]],
      [result.imageToken, f.id, 'other-outlet', 'Bearer session', [action]],
      [result.imageToken, f.id, 'outlet', 'Bearer another-session', [action]],
      [result.imageToken, f.id, 'outlet', 'Bearer session', ['other-action']],
    ] as const) assert.throws(() => requireProductImageAuthorization(secret, grant, user, outlet, session, [...actions]), { status: 403 });
  });
}
test('inactive, unauthenticated, unauthorized, missing PIN and forged identities fail closed', async () => {
  const body = { action: 'bulk', quickPin: '1234' };
  const f = fixture();
  await assert.rejects(f.verify(body, null), { status: 401 });
  await assert.rejects(f.verify(body, f.id, 'foreign'), { status: 403 });
  await assert.rejects(f.verify({ ...body, profileId: 'forged' }), { status: 400 });
  f.profile.active = false; await assert.rejects(f.verify(body), { status: 403 });
  f.profile.active = true; delete f.profile.quickPin;
  await assert.rejects(f.verify(body), { status: 422 });
  await assert.rejects(f.verify(body, f.id, 'outlet', ''), { status: 503 });
});
test('five wrong attempts are rate limited and grants expire after fifteen minutes', async t => {
  const f = fixture();
  for (let i = 0; i < 5; i++) await assert.rejects(f.verify({ action: 'remove', quickPin: '9999' }), { status: 422 });
  await assert.rejects(f.verify({ action: 'remove', quickPin: '1234' }), { status: 429 });
  const g = fixture(), start = Date.now();
  const result = await g.verify({ action: 'remove', quickPin: '1234' });
  t.mock.method(Date, 'now', () => start + 16 * 60_000);
  assert.throws(() => requireProductImageAuthorization(secret, result.imageToken, g.id, 'outlet', 'Bearer session', ['remove']), { status: 403 });
});

test('image authorization uses the signed-in login PIN, preserving leading zeroes', async () => {
  const f = fixture();
  f.profile.quickPin = '0123';
  await assert.rejects(f.verify({ action: 'bulk', quickPin: '1234' }), { status: 422 });
  assert.equal((await f.verify({ action: 'bulk', quickPin: '0123' })).verified, true);
});
