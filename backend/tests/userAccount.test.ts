import assert from 'node:assert/strict';
import test from 'node:test';
import type { Firestore } from 'firebase-admin/firestore';
import { readUserAccount, updateUserAccount } from '../src/userAccount.js';

function fixture(profile: Record<string, unknown> | undefined = {
  id: 'public-id', active: true, name: 'Database User', email: 'database@example.com', quickPin: '123456',
  roll: 'admin', outletId: 'shop', permissions: ['sales'], passwordHash: 'PRIVATE HASH',
}) {
  const records: Record<string, Record<string, unknown> | undefined> = { signed: profile, other: { active: true, name: 'Other User', email: 'other@example.com' } };
  const reads: string[] = [];
  const writes: { path: string; changes: Record<string, string> }[] = [];
  const db = {
    collection: (name: string) => {
      assert.equal(name, 'USER_PROFILE');
      return { doc: (id: string) => ({ id, path: `${name}/${id}`, get: async () => snapshot(id) }) };
    },
    runTransaction: async (work: (transaction: unknown) => unknown) => work({
      get: async (ref: { id: string }) => snapshot(ref.id),
      update: (ref: { id: string; path: string }, changes: Record<string, string>) => {
        assert.ok(records[ref.id], 'Update cannot create documents');
        writes.push({ path: ref.path, changes });
        records[ref.id] = { ...records[ref.id], ...changes };
      },
      // Deliberately no set/create/delete methods: accidental usage fails the test.
    }),
  } as unknown as Firestore;
  function snapshot(id: string) {
    reads.push(id);
    return { exists: !!records[id], data: () => records[id] };
  }
  return { db, records, reads, writes };
}

test('loads the current user PIN without returning hashes or unrelated secrets', async () => {
  const f = fixture();
  assert.deepEqual(await readUserAccount(f.db, 'signed'), { name: 'Database User', email: 'database@example.com', loginPin: '123456', hasLoginPin: true });
  assert.deepEqual(f.reads, ['signed']); assert.deepEqual(f.writes, []);
});
for (const [field, value] of [['name', 'Edited Name'], ['email', ' NEW@Example.com ']] as const) {
  test(`editing ${field} updates only the existing ${field} field`, async () => {
    const f = fixture(); const before = structuredClone(f.records); const expected = value.trim().toLowerCase();
    const result = await updateUserAccount(f.db, 'signed', { [field]: value });
    assert.deepEqual(f.writes, [{ path: 'USER_PROFILE/signed', changes: { [field]: field === 'email' ? expected : value } }]);
    assert.deepEqual(f.records, { ...before, signed: { ...before.signed, [field]: field === 'email' ? expected : value } });
    assert.equal(result[field], field === 'email' ? expected : value);
    assert.equal(result.loginPin, '123456');
    assert.ok(!JSON.stringify(result).includes('PRIVATE HASH'));
  });
}
test('unchanged and empty patches perform no writes', async () => {
  const f = fixture(); await updateUserAccount(f.db, 'signed', { name: 'Database User' });
  await updateUserAccount(f.db, 'signed', {}); assert.deepEqual(f.writes, []);
});
test('rejects protected fields, invalid values and non-object bodies without writes', async () => {
  for (const body of [{ name: '' }, { name: '  ' }, { name: 'X'.repeat(201) }, { email: 'invalid' }, { email: '' },
    { userId: 'other' }, { profileDocId: 'other', name: 'Hacked' }, { roll: 'admin' }, { role: 'admin' },
    { outletId: 'other' }, { permissions: [] }, { quickPin: '9999' }, { passwordHash: 'hash' }, null, []]) {
    const f = fixture(); const before = structuredClone(f.records);
    await assert.rejects(updateUserAccount(f.db, 'signed', body), { status: 400 });
    assert.deepEqual(f.writes, []); assert.deepEqual(f.records, before);
  }
});
test('missing and inactive profiles cannot be read or updated', async () => {
  for (const inactive of [false, true]) {
    const f = fixture(); f.records.signed = inactive ? { active: false, name: 'Inactive' } : undefined;
    const status = inactive ? 403 : 404;
    await assert.rejects(readUserAccount(f.db, 'signed'), { status });
    await assert.rejects(updateUserAccount(f.db, 'signed', { name: 'Change' }), { status });
    assert.deepEqual(f.writes, []);
  }
});
test('absent fields are not invented or made editable', async () => {
  const f = fixture({ active: true });
  assert.deepEqual(await readUserAccount(f.db, 'signed'), { name: null, email: null, loginPin: null, hasLoginPin: false });
  await assert.rejects(updateUserAccount(f.db, 'signed', { email: 'new@example.com' }), { status: 400 });
  await assert.rejects(updateUserAccount(f.db, 'signed', { name: 'New' }), { status: 400 });
  assert.deepEqual(f.writes, []);
});
test('failed transactions do not report success', async () => {
  const f = fixture(); f.db.runTransaction = async () => { throw new Error('database unavailable'); };
  await assert.rejects(updateUserAccount(f.db, 'signed', { name: 'Changed' }), /database unavailable/);
  assert.deepEqual(f.writes, []);
});

test('only valid retrievable PINs can be displayed, preserving leading zeroes', async () => {
  for (const pin of ['0123', '12345', '123456', 1234]) {
    const f = fixture({ active: true, quickPin: pin });
    assert.equal((await readUserAccount(f.db, 'signed')).loginPin, String(pin));
  }
  for (const pin of ['$2b$12$HASH', 'PRIVATE SECRET', '123', '1234567', '1234abc', { hash: 'SECRET' }, null]) {
    const f = fixture({ active: true, quickPin: pin });
    const result = await readUserAccount(f.db, 'signed');
    assert.equal(result.loginPin, null);
    assert.ok(!JSON.stringify(result).includes('SECRET'));
    assert.ok(!JSON.stringify(result).includes('HASH'));
  }
});
