import type { Request, RequestHandler } from 'express';
import type { Firestore } from 'firebase-admin/firestore';
import { DailyUsageError, operateOutletDailyUsage } from './dailyUsage.js';
import { ProductCreationError } from './productCreation.js';

export function createWebUsageGuard(deps: {
  readToken: (req: Request) => { profileDocId: string } | null;
  db: () => Firestore;
  assigned: (profile: Record<string, unknown>) => string[];
  operate: typeof operateOutletDailyUsage;
}): RequestHandler {
  return async (req, res, next) => {
    // These authenticated lifecycle endpoints must remain reachable after expiry/exhaustion.
    if (/^\/usage\/(initialize|start|heartbeat|stop|status)\/?$/.test(req.path)) { next(); return; }
    res.setHeader('Cache-Control', 'no-store');
    try {
      const token = deps.readToken(req);
      if (!token) throw new ProductCreationError(401, 'Your session has expired. Please sign in again.');
      const target = String(req.params.outletId ?? '');
      const context = req.header('x-web-usage-outlet') || target;
      // Transfer preview reads another authorized outlet while consuming the selected source allowance.
      // All writes and every other read must use their own outlet's session.
      if (context !== target && !(req.method === 'GET' && /^\/(categories|products)\/?$/.test(req.path))) {
        throw new DailyUsageError(403, 'USAGE_OUTLET_MISMATCH', 'Usage authorization does not match this outlet.');
      }
      const sessionId = req.header('x-web-usage-session');
      const generation = req.header('x-web-usage-generation');
      if (!sessionId || !generation) throw new DailyUsageError(428, 'USAGE_SESSION_REQUIRED', 'Enter the outlet before using Web POS.');
      await deps.operate(deps.db(), context, token.profileDocId, deps.assigned, { action: 'check', sessionId, generation });
      next();
    } catch (error) {
      res.status(error instanceof ProductCreationError ? error.status : 503).json({ success: false,
        code: error instanceof DailyUsageError ? error.code : 'USAGE_UNAVAILABLE',
        message: error instanceof ProductCreationError ? error.message : 'Unable to verify Web POS usage. Access has not been granted.' });
    }
  };
}
