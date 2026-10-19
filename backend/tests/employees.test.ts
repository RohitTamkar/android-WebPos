import assert from 'node:assert/strict';
import test from 'node:test';
import type { Firestore } from 'firebase-admin/firestore';
import { listOutletEmployees, createOutletEmployee } from '../src/employees.js';

const assigned = (profile: Record<string, unknown>) => [...new Set([
  ...(Array.isArray(profile.outlets) ? profile.outlets : []),
  ...(Array.isArray(profile.outletList) ? profile.outletList : []), profile.outletId,
].filter((id): id is string => typeof id === 'string'))];
const employee = { name: 'Existing Person', mobile: '9876543210', searchCode: 1, shortName: 'E',
  balanceAmt: '0', dateOfJoining: '2026-10-19', userId: '', id: null, allowadvancepayment: false };
const draft = { requestId: '11111111-1111-4111-8111-111111111111', name: 'New Person', mobile: '+91 98765 43211',
  searchCode: 2, shortName: 'N', balanceAmt: '25.50', dateOfJoining: '2026-10-19', userId: 'colleague' };
function fixture() {
  const records = new Map<string, Record<string, unknown>>([
    ['OUTLET/outlet', { active: true }], ['OUTLET/foreign', { active: true }],
    ['USER_PROFILE/current', { active: true, outletId: 'outlet', name: 'Signed User', quickPin: 'SECRET' }],
    ['USER_PROFILE/colleague', { active: true, outlets: ['outlet'], outletList: ['outlet'], name: 'Colleague', quickPin: 'SECRET' }],
    ['USER_PROFILE/foreign-user', { active: true, outletId: 'foreign', name: 'Foreign User' }],
    ['USER_PROFILE/inactive', { active: false, outletId: 'outlet', name: 'Inactive User' }],
    ['OUTLET/outlet/EMPLOYEE/existing', structuredClone(employee)],
    ['OUTLET/foreign/EMPLOYEE/other', { ...employee, name: 'Foreign Person' }],
  ]);
  const reads: string[] = [], writes: { path: string; fields: Record<string, unknown> }[] = [];
  let failCommit = false;
  function collection(path: string, filters: [string, string, unknown][] = [], fields?: string[]): any {
    return { path, isCollection: true,
      doc: (id: string) => doc(`${path}/${id}`),
      where: (key: string, op: string, value: unknown) => collection(path, [...filters, [key, op, value]], fields),
      select: (...selected: string[]) => collection(path, filters, selected),
      get: async () => {
        reads.push(path);
        const docs = [...records].filter(([key, value]) => key.startsWith(path + '/') && key.split('/').length === path.split('/').length + 1
          && filters.every(([field, op, expected]) => op === 'array-contains' ? Array.isArray(value[field]) && value[field].includes(expected) : value[field] === expected))
          .map(([key, value]) => ({ id: key.split('/').at(-1), data: () => fields ? Object.fromEntries(fields.filter(f => f in value).map(f => [f, value[f]])) : structuredClone(value) }));
        return { docs, size: docs.length, empty: !docs.length };
      },
    };
  }
  function doc(path: string): any {
    return { path, id: path.split('/').at(-1), collection: (name: string) => collection(`${path}/${name}`),
      get: async () => { reads.push(path); return { exists: records.has(path), data: () => records.has(path) ? structuredClone(records.get(path)) : undefined }; },
    };
  }
  const db = { collection,
    runTransaction: async (work: (tx: unknown) => unknown) => {
      const pending: { path: string; fields: Record<string, unknown> }[] = [];
      const result = await work({ get: (ref: any) => ref.get(), create: (ref: any, fields: Record<string, unknown>) => {
        assert.ok(!records.has(ref.path), 'Never overwrite existing employee'); pending.push({ path: ref.path, fields });
      } });
      if (failCommit) throw new Error('DATABASE FAILURE');
      for (const write of pending) { records.set(write.path, structuredClone(write.fields)); writes.push(write); }
      return result;
    },
  } as unknown as Firestore;
  return { db, records, reads, writes, fail: () => { failCommit = true; } };
}
test('lists only the authorized outlet pool and safe assigned account options', async () => {
  const f = fixture(); const result = await listOutletEmployees(f.db, 'outlet', 'current', assigned);
  assert.deepEqual(result.employees, [{ documentId: 'existing', ...Object.fromEntries(Object.entries(employee).filter(([key]) => !['id', 'allowadvancepayment'].includes(key))) }]);
  assert.equal(result.nextSearchCode, 2);
  assert.deepEqual(result.userAccounts.map(row => row.userId).sort(), ['colleague', 'current']);
  assert.ok(!JSON.stringify(result).includes('SECRET')); assert.deepEqual(f.writes, []);
});
test('empty list provides the first search code and does not create records', async () => {
  const f = fixture(); f.records.delete('OUTLET/outlet/EMPLOYEE/existing');
  const result = await listOutletEmployees(f.db, 'outlet', 'current', assigned);
  assert.deepEqual(result.employees, []); assert.equal(result.nextSearchCode, 1); assert.deepEqual(f.writes, []);
});
test('creates exactly the established nine-field employee document without changing other records', async () => {
  const f = fixture(); const before = structuredClone(f.records);
  const result = await createOutletEmployee(f.db, 'outlet', 'current', assigned, draft);
  assert.equal(f.writes.length, 1); assert.match(result.documentId, /^[a-z0-9]{20}$/);
  assert.equal(f.writes[0]!.path, `OUTLET/outlet/EMPLOYEE/${result.documentId}`);
  const { requestId: _requestId, ...fields } = draft;
  assert.deepEqual(f.writes[0]!.fields, { ...fields, id: result.documentId, allowadvancepayment: false });
  for (const [path, original] of before) assert.deepEqual(f.records.get(path), original);
  const listed = await listOutletEmployees(f.db, 'outlet', 'current', assigned);
  assert.ok(listed.employees.some(row => row.documentId === result.documentId));
});
test('retrying a confirmed save does not duplicate the employee or overwrite changes', async () => {
  const f = fixture(); const first = await createOutletEmployee(f.db, 'outlet', 'current', assigned, draft);
  assert.deepEqual(await createOutletEmployee(f.db, 'outlet', 'current', assigned, draft), first);
  assert.equal(f.writes.length, 1);
  await assert.rejects(createOutletEmployee(f.db, 'outlet', 'current', assigned, { ...draft, name: 'Changed' }), { status: 409 });
  assert.equal(f.writes.length, 1);
});
test('prevents duplicate search codes and normalized mobile numbers', async () => {
  for (const patch of [{ searchCode: 1 }, { mobile: '98765 43210' }]) {
    const f = fixture(); await assert.rejects(createOutletEmployee(f.db, 'outlet', 'current', assigned, { ...draft, ...patch }), { status: 409 });
    assert.deepEqual(f.writes, []);
  }
});
test('rejects unauthenticated, inactive, unassigned or missing outlet access', async () => {
  for (const [outlet, user, status] of [['outlet', null, 401], ['foreign', 'current', 403], ['outlet', 'inactive', 403], ['outlet', 'missing', 403], ['bad/path', 'current', 400]] as const) {
    const f = fixture();
    await assert.rejects(listOutletEmployees(f.db, outlet, user, assigned), { status });
    await assert.rejects(createOutletEmployee(f.db, outlet, user, assigned, draft), { status });
    assert.deepEqual(f.writes, []);
  }
  const f = fixture(); f.records.delete('OUTLET/outlet');
  await assert.rejects(listOutletEmployees(f.db, 'outlet', 'current', assigned), { status: 404 });
  await assert.rejects(createOutletEmployee(f.db, 'outlet', 'current', assigned, draft), { status: 404 });
});
test('assignments are limited to active accounts belonging to the same outlet', async () => {
  for (const userId of ['foreign-user', 'inactive', 'missing']) {
    const f = fixture(); await assert.rejects(createOutletEmployee(f.db, 'outlet', 'current', assigned, { ...draft, userId }), { status: 422 }); assert.deepEqual(f.writes, []);
  }
  const f = fixture(); await createOutletEmployee(f.db, 'outlet', 'current', assigned, { ...draft, userId: '' }); assert.equal(f.writes.length, 1);
});
test('validates required fields, dates, balances and protected fields', async () => {
  for (const patch of [{ name: '' }, { mobile: '' }, { mobile: 'bad' }, { mobile: '---' }, { shortName: '' }, { balanceAmt: 'NaN' },
    { dateOfJoining: '2026-02-30' }, { searchCode: 0 }, { searchCode: 1.2 }, { type: 'captain' }, { allowadvancepayment: true }, { id: 'other' }]) {
    const f = fixture(); await assert.rejects(createOutletEmployee(f.db, 'outlet', 'current', assigned, { ...draft, ...patch }), { status: 422 }); assert.deepEqual(f.writes, []);
  }
});
test('failed database commit is not reported as a successful create', async () => {
  const f = fixture(); f.fail();
  await assert.rejects(createOutletEmployee(f.db, 'outlet', 'current', assigned, draft), /DATABASE FAILURE/);
  assert.deepEqual(f.writes, []); assert.equal(f.records.size, 8);
});
