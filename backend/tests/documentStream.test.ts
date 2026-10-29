import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';
import { gunzipSync } from 'node:zlib';
import express from 'express';
import type { Query, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { streamDocuments } from '../src/documentStream.js';

const toProduct = (document: QueryDocumentSnapshot) => ({ documentId: document.id, fields: document.data() });

function fakeQuery(count: number, failAfter?: number) {
  const docs = Array.from({ length: count }, (_, index) => ({ id: `p${index}`, data: () => ({ name: `Product ${index}`, id: 'stored-id' }) }));
  return {
    stream: () => Readable.from((async function* () {
      for (const [index, doc] of docs.entries()) {
        if (index === failAfter) throw new Error('firestore stream failed');
        yield doc;
      }
    })()),
  } as unknown as Query;
}

async function request(query: Query, encoding = 'identity') {
  const app = express();
  app.get('/products', (req, res) => { void streamDocuments(req, res, query, toProduct, 'Unable to load products right now'); });
  const server = app.listen(0);
  try {
    const { port } = server.address() as { port: number };
    const response = await fetch(`http://127.0.0.1:${port}/products`, { headers: { 'Accept-Encoding': encoding } });
    const body = Buffer.from(await response.arrayBuffer());
    return { response, lines: body.toString('utf8').trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>) };
  } finally { server.close(); }
}

test('lists stream as newline-delimited batches with an end marker', async () => {
  const { response, lines } = await request(fakeQuery(2500));
  assert.match(response.headers.get('content-type') ?? '', /application\/x-ndjson/);
  const products = lines.filter(line => line.type === 'items').flatMap(line => line.data as { documentId: string; fields: Record<string, unknown> }[]);
  assert.equal(products.length, 2500);
  assert.ok(lines.filter(line => line.type === 'items').every(line => (line.data as unknown[]).length <= 1000), 'batches are bounded');
  assert.deepEqual(products[0], { documentId: 'p0', fields: { name: 'Product 0', id: 'stored-id' } }, 'document ID and stored id stay separate');
  assert.ok(!lines.some(line => line.type === 'total'), 'no count query delays the first rows');
  assert.deepEqual(lines.at(-1), { type: 'end', count: 2500 });
});

test('the first row reaches the browser before Firestore finishes the rest of the list', async () => {
  let release!: () => void;
  const remaining = new Promise<void>(resolve => { release = resolve; });
  const query = { stream: () => Readable.from((async function* () {
    yield { id: 'first', data: () => ({ name: 'First product' }) };
    await remaining;
    yield { id: 'second', data: () => ({ name: 'Second product' }) };
  })()) } as unknown as Query;
  const app = express();
  app.get('/products', (req, res) => { void streamDocuments(req, res, query, toProduct, 'Failed'); });
  const server = app.listen(0);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);
  try {
    const { port } = server.address() as { port: number };
    const response = await fetch(`http://127.0.0.1:${port}/products`, { signal: controller.signal });
    const reader = response.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    assert.match(first, /First product/);
    assert.doesNotMatch(first, /Second product|"type":"end"/);
    release();
    await reader.cancel();
  } finally { clearTimeout(timeout); release(); controller.abort(); server.close(); }
});

test('gzip-capable clients receive a compressed stream with the same lines', async () => {
  const app = express();
  app.get('/products', (req, res) => { void streamDocuments(req, res, fakeQuery(50), toProduct, 'Unable to load products right now'); });
  const server = app.listen(0);
  try {
    const { port } = server.address() as { port: number };
    const http = await import('node:http');
    const { headers, body } = await new Promise<{ headers: Record<string, unknown>; body: Buffer }>((resolve, reject) => {
      http.get({ port, path: '/products', headers: { 'accept-encoding': 'gzip' } }, res => {
        const chunks: Buffer[] = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => resolve({ headers: res.headers, body: Buffer.concat(chunks) }));
      }).on('error', reject);
    });
    assert.equal(headers['content-encoding'], 'gzip');
    const lines = gunzipSync(body).toString('utf8').trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>);
    assert.deepEqual(lines.at(-1), { type: 'end', count: 50 });
  } finally { server.close(); }
});

test('a Firestore failure mid-stream ends with an error line and never an end marker', async () => {
  const { lines } = await request(fakeQuery(10, 4));
  assert.deepEqual(lines.at(-1), { type: 'error', message: 'Unable to load products right now' });
  assert.ok(!lines.some(line => line.type === 'end'));
});
