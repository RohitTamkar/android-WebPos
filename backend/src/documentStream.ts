import type { Readable } from 'node:stream';
import { createGzip } from 'node:zlib';
import type { Request, Response } from 'express';
import type { Query, QueryDocumentSnapshot } from 'firebase-admin/firestore';

const FLUSH_MS = 200;
const MAX_BATCH = 1000;

export const LIST_STREAM_TYPE = 'application/x-ndjson';

export const wantsListStream = (req: Request) => (req.headers.accept ?? '').includes(LIST_STREAM_TYPE);

// Sends a collection as newline-delimited JSON while Firestore returns it, so a
// page can show the first records before the whole collection has been read.
// Lines: one or more {"type":"items"}, then {"type":"end"} or {"type":"error"}.
// A list without "end" is incomplete. No total is sent: a parallel count query
// delays the first rows by over a second on large collections.
export async function streamDocuments<T>(req: Request, res: Response, query: Query,
  toItem: (document: QueryDocumentSnapshot) => T, failureMessage: string) {
  let closed = false;
  res.on('close', () => { closed = true; });
  res.status(200);
  res.setHeader('Content-Type', `${LIST_STREAM_TYPE}; charset=utf-8`);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Accel-Buffering', 'no');
  const gzip = /\bgzip\b/i.test(req.headers['accept-encoding'] ?? '') ? createGzip() : null;
  if (gzip) {
    res.setHeader('Content-Encoding', 'gzip');
    res.vary('Accept-Encoding');
    gzip.pipe(res);
  }
  const write = (line: unknown) => {
    if (closed) return;
    (gzip ?? res).write(`${JSON.stringify(line)}\n`);
    gzip?.flush();
  };
  const finish = () => { if (gzip) gzip.end(); else res.end(); };

  let batch: T[] = [];
  let sent = 0;
  let lastFlush = Date.now();
  const flush = () => {
    if (!batch.length) return;
    write({ type: 'items', data: batch });
    sent += batch.length; batch = []; lastFlush = Date.now();
  };
  const stream = query.stream() as unknown as Readable;
  try {
    for await (const document of stream as AsyncIterable<QueryDocumentSnapshot>) {
      if (closed) break;
      batch.push(toItem(document));
      if (batch.length >= MAX_BATCH || Date.now() - lastFlush >= FLUSH_MS) flush();
    }
    if (closed) { stream.destroy(); return; }
    flush();
    write({ type: 'end', count: sent });
  } catch (error) {
    console.error('Streaming an outlet list failed:', error);
    write({ type: 'error', message: failureMessage });
  } finally {
    finish();
  }
}
