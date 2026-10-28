import type { Request, RequestHandler } from 'express';
import type { Firestore } from 'firebase-admin/firestore';
import { DailyUsageError, readAuthorizedOutletLogoName } from './dailyUsage.js';
import { ProductCreationError } from './productCreation.js';
import { ImageStorageError, readOutletLogo, saveOutletLogo, removeOutletLogo, type MasterImageStorageBucket } from './imageStorage.js';

// Logo access validates the existing policy/lease without Firestore writes.
// Only explicit PUT/DELETE actions mutate the selected Storage object.
export function createOutletLogoHandler(deps: {
  readToken: (req: Request) => { profileDocId: string } | null;
  db: () => Firestore;
  bucket: () => MasterImageStorageBucket;
  assigned: (profile: Record<string, unknown>) => string[];
}, action: 'read' | 'upload' | 'remove' = 'read'): RequestHandler {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      const variant = req.query?.variant ?? 'header';
      if (variant !== 'header' && variant !== 'footer') throw new ImageStorageError(400, 'Select Header Logo or Footer Logo.');
      const token = deps.readToken(req);
      if (!token) throw new ProductCreationError(401, 'Your session has expired.');
      const outletId = String(req.params.outletId ?? '');
      const context = req.header('x-web-usage-outlet');
      if (context && context !== outletId) throw new DailyUsageError(403, 'USAGE_OUTLET_MISMATCH', 'Usage authorization does not match this outlet.');
      const name = await readAuthorizedOutletLogoName(deps.db(), outletId, token.profileDocId, deps.assigned,
        req.header('x-web-usage-session') ?? '', req.header('x-web-usage-generation') ?? '');
      if (action === 'upload') {
        const data = await saveOutletLogo(deps.bucket(), name, outletId, variant, Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0),
          req.header('x-logo-expected-generation') ?? '', (req.header('content-type') ?? '').split(';')[0]!.trim().toLowerCase());
        res.json({ success: true, data }); return;
      }
      if (action === 'remove') {
        const data = await removeOutletLogo(deps.bucket(), name, outletId, variant, req.header('x-logo-expected-generation') ?? '');
        res.json({ success: true, data }); return;
      }
      const image = await readOutletLogo(deps.bucket(), name, outletId, variant, generation => res.setHeader('X-Logo-Generation', generation));
      res.setHeader('X-Logo-Generation', image.generation);
      res.setHeader('Content-Type', image.contentType);
      res.send(image.bytes);
    } catch (error) {
      const status = error instanceof ProductCreationError || error instanceof ImageStorageError ? error.status : 503;
      res.status(status).json({ success: false, message: error instanceof ImageStorageError ? error.message : 'The outlet logo is unavailable.' });
    }
  };
}
