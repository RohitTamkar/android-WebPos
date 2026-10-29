import type { Request, RequestHandler } from 'express';
import { createHash } from 'node:crypto';
import type { Firestore, QuerySnapshot } from 'firebase-admin/firestore';
import { ProductCreationError } from './productCreation.js';

const collections = { products: ['PRODUCT', 'CATEGORY'], categories: ['CATEGORY', 'PRODUCT'], customers: ['CUSTOMER'] } as const;

// Read-only notifications. Lists still use their existing authenticated routes;
// no Firestore records or accounting state are written by a subscription.
export function createMasterSyncHandler(deps: {
  db: () => Firestore;
  authorize: (req: Request) => Promise<void>;
}): RequestHandler {
  return async (req, res) => {
    const kind = req.query.kind;
    if (typeof kind !== 'string' || !Object.hasOwn(collections, kind)) {
      res.status(400).json({ success: false, message: 'Select a valid master list.' }); return;
    }
    const unsubscribers: (() => void)[] = [];
    let closed = false, checking = false;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let lifetime: ReturnType<typeof setTimeout> | undefined;
    const close = () => {
      if (closed) return;
      closed = true; clearInterval(heartbeat); clearTimeout(lifetime);
      for (const unsubscribe of unsubscribers) unsubscribe();
      res.end();
    };
    res.on('close', close);
    try {
      await deps.authorize(req);
      if (closed) return;
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();
      const send = (type: string, extra: Record<string, string> = {}) => { if (!closed && !res.write(`${JSON.stringify({ type, ...extra })}\n`)) close(); };
      // Every connection starts with the current state. The version (document IDs and
      // Firestore update times only) lets a reconnecting page skip an unchanged list.
      const changed = (collection: string) => (snapshot?: QuerySnapshot) => {
        if (!snapshot?.docs) { send('changed'); return; }
        const hash = createHash('sha1');
        for (const document of snapshot.docs) hash.update(`${document.id}\u0000${document.updateTime.toMillis()}\u0000`);
        send('changed', { collection, version: `${snapshot.size}:${hash.digest('base64url')}` });
      };
      const outlet = deps.db().collection('OUTLET').doc(String(req.params.outletId));
      for (const collection of collections[kind as keyof typeof collections]) {
        if (closed) break;
        const query = kind === 'categories' && collection === 'PRODUCT' ? outlet.collection(collection).select('category') : outlet.collection(collection);
        const unsubscribe = query.onSnapshot(changed(collection), close);
        if (closed) unsubscribe(); else unsubscribers.push(unsubscribe);
      }
      // Recheck the account, outlet and usage lease throughout a connection.
      heartbeat = setInterval(() => {
        if (closed || checking) return;
        checking = true;
        void deps.authorize(req).then(() => send('heartbeat'), close).finally(() => { checking = false; });
      }, 15_000);
      // Reconnect through normal authentication, including on bounded hosts.
      lifetime = setTimeout(close, 55_000);
    } catch (error) {
      if (closed) return;
      if (!res.headersSent) res.status(error instanceof ProductCreationError ? error.status : 503)
        .json({ success: false, message: 'Live updates are unavailable.' });
      close();
    }
  };
}
