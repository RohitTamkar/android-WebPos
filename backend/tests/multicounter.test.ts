import assert from 'node:assert/strict';
import test from 'node:test';
import type { Firestore } from 'firebase-admin/firestore';
import { readOutletMulticounter } from '../src/multicounter.js';
const assigned = (profile: Record<string, unknown>) => typeof profile.outletId === 'string' ? [profile.outletId] : [];
function fixture(setting: unknown = false) {
  const records = new Map<string, Record<string, unknown>>([
    ['USER_PROFILE/current', { active: true, outletId: 'outlet', quickPin: 'SECRET' }],
    ['USER_PROFILE/inactive', { active: false, outletId: 'outlet' }],
    ['OUTLET/outlet', { name: 'Saved Outlet Name', multiCounter: setting, active: true, userId: 'PRIVATE' }],
  ]);
  const reads: string[] = [];
  let failed = false;
  const db = { collection: (collection: string) => {
    assert.ok(['USER_PROFILE', 'OUTLET'].includes(collection), 'Never read DEVICE, SHIFT, or invent a counter collection');
    return { doc: (id: string) => ({ get: async () => {
      reads.push(`${collection}/${id}`); if (failed) throw new Error('DATABASE FAILURE');
      return { exists: records.has(`${collection}/${id}`), data: () => records.get(`${collection}/${id}`) };
    } }) };
  } } as unknown as Firestore;
  return { db, records, reads, fail: () => { failed = true; } };
}
test('returns the actual false multicounter setting without inferring counters from registered devices', async () => {
  const f = fixture(); const before = structuredClone(f.records);
  assert.deepEqual(await readOutletMulticounter(f.db, 'outlet', 'current', assigned), { outletName: 'Saved Outlet Name', multiCounter: false });
  assert.deepEqual(f.records, before); assert.deepEqual(f.reads, ['USER_PROFILE/current', 'OUTLET/outlet']);
});
test('enabled setting remains a flag, not an invented list of counter names and numbers', async () => {
  const f = fixture(true); const result = await readOutletMulticounter(f.db, 'outlet', 'current', assigned);
  assert.deepEqual(result, { outletName: 'Saved Outlet Name', multiCounter: true });
  assert.ok(!JSON.stringify(result).includes('SECRET')); assert.ok(!JSON.stringify(result).includes('PRIVATE'));
});
test('missing and malformed flags remain unknown', async () => {
  for (const value of [null, 'true', 'false', 1, 0]) {
    const f = fixture(value); assert.equal((await readOutletMulticounter(f.db, 'outlet', 'current', assigned)).multiCounter, null);
  }
  const f = fixture(); delete f.records.get('OUTLET/outlet')!.multiCounter;
  assert.equal((await readOutletMulticounter(f.db, 'outlet', 'current', assigned)).multiCounter, null);
});
test('missing, inactive and foreign-outlet sessions cannot read counter configuration', async () => {
  for (const [outlet, user, status] of [['outlet', null, 401], ['foreign', 'current', 403], ['outlet', 'inactive', 403], ['outlet', 'missing', 403], ['bad/path', 'current', 400]] as const) {
    const f = fixture(); await assert.rejects(readOutletMulticounter(f.db, outlet, user, assigned), { status });
    assert.ok(!f.reads.some(path => path.startsWith('OUTLET/')));
  }
});
test('missing outlet and read failures are reported without writes', async () => {
  const f = fixture(); f.records.delete('OUTLET/outlet');
  await assert.rejects(readOutletMulticounter(f.db, 'outlet', 'current', assigned), { status: 404 });
  const failed = fixture(); failed.fail(); await assert.rejects(readOutletMulticounter(failed.db, 'outlet', 'current', assigned), /DATABASE FAILURE/);
});
