import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import type { Firestore } from 'firebase-admin/firestore';
import type { Request, Response } from 'express';
import { createMasterSyncHandler } from '../src/masterSync.js';
import { ProductCreationError } from '../src/productCreation.js';

function fixture(kind = 'products') {
  const listeners = new Map<string, (snapshot?: unknown) => void>();
  const stopped: string[] = [], selected: string[] = [], messages: string[] = [], lines: Record<string, string>[] = [];
  let checks = 0, denied = false;
  const db = { collection: (name: string) => {
    assert.equal(name, 'OUTLET');
    return { doc: (id: string) => {
      assert.equal(id, 'shop');
      return { collection: (collection: string) => {
        const query = { onSnapshot: (changed: (snapshot?: unknown) => void) => { listeners.set(collection, changed); return () => { stopped.push(collection); }; },
          select: (field: string) => { selected.push(`${collection}.${field}`); return query; } };
        return query;
      } };
    } };
  } } as unknown as Firestore;
  const response = Object.assign(new EventEmitter(), {
    headersSent: false, statusCode: 200, ended: false,
    setHeader: () => {}, flushHeaders: () => { response.headersSent = true; },
    status: (code: number) => { response.statusCode = code; return response; }, json: () => response,
    write: (line: string) => { messages.push(JSON.parse(line).type); lines.push(JSON.parse(line)); return true; },
    end: () => { response.ended = true; },
  });
  const handler = createMasterSyncHandler({ db: () => db, authorize: async () => {
    checks++; if (denied) throw new ProductCreationError(403, 'Denied');
  } });
  return { listeners, stopped, selected, messages, lines, response, checks: () => checks, deny: () => { denied = true; },
    start: () => handler({ query: { kind }, params: { outletId: 'shop' } } as unknown as Request, response as unknown as Response, () => {}) };
}

test('outlet change feed watches only the required collections and cleans up on disconnect', async () => {
  const f = fixture(); await f.start();
  assert.deepEqual([...f.listeners.keys()], ['PRODUCT', 'CATEGORY']);
  f.listeners.get('PRODUCT')!(); f.listeners.get('CATEGORY')!();
  assert.deepEqual(f.messages, ['changed', 'changed']);
  f.response.emit('close');
  assert.deepEqual(f.stopped, ['PRODUCT', 'CATEGORY']);
  f.listeners.get('PRODUCT')!(); assert.equal(f.messages.length, 2);
});

test('customers never subscribe to products; category counts watch only product category fields', async () => {
  for (const kind of ['customers', 'categories']) {
    const f = fixture(kind); await f.start();
    assert.deepEqual([...f.listeners.keys()], kind === 'customers' ? ['CUSTOMER'] : ['CATEGORY', 'PRODUCT']);
    assert.deepEqual(f.selected, kind === 'categories' ? ['PRODUCT.category'] : []);
    f.response.emit('close');
  }
});

test('invalid lists and denied users cannot install a listener', async () => {
  const invalid = fixture('arbitrary'); await invalid.start();
  assert.equal(invalid.response.statusCode, 400); assert.equal(invalid.listeners.size, 0);
  const denied = fixture(); denied.deny(); await denied.start();
  assert.equal(denied.response.statusCode, 403); assert.equal(denied.listeners.size, 0);
});

test('live connections recheck access and unsubscribe when the lease is no longer valid', async t => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  const f = fixture(); await f.start(); f.deny();
  t.mock.timers.tick(15_000);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(f.checks(), 2); assert.equal(f.response.ended, true);
  assert.deepEqual(f.stopped, ['PRODUCT', 'CATEGORY']);
});

test('each notice carries a version that changes only when documents are added, edited or removed', async () => {
  const f = fixture(); await f.start();
  const snapshot = (...docs: [string, number][]) => ({ size: docs.length, docs: docs.map(([id, at]) => ({ id, updateTime: { toMillis: () => at } })) });
  const product = f.listeners.get('PRODUCT')!;
  product(snapshot(['a', 1], ['b', 2])); product(snapshot(['a', 1], ['b', 2]));
  product(snapshot(['a', 1], ['b', 3])); product(snapshot(['a', 1]));
  const versions = f.lines.map(line => line.version);
  assert.ok(f.lines.every(line => line.type === 'changed' && line.collection === 'PRODUCT'));
  assert.equal(versions[0], versions[1], 'an unchanged collection reports the same version');
  assert.equal(new Set(versions).size, 3, 'edits and deletions produce new versions');
  assert.ok(!JSON.stringify(f.lines).includes('"a"'), 'no document IDs or data are sent');
  f.response.emit('close');
});
