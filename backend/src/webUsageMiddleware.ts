import type { Request, RequestHandler } from 'express';
import type { Firestore } from 'firebase-admin/firestore';
import { DailyUsageError, operateOutletDailyUsage } from './dailyUsage.js';
import { ProductCreationError, requireProductOutlet } from './productCreation.js';
import { DAILY_WEB_USAGE_ENABLED } from '../../shared/webUsageFeature.js';

export function createWebUsageGuard(deps: {
  readToken: (req: Request) => { profileDocId: string } | null;
  db: () => Firestore;
  assigned: (profile: Record<string, unknown>) => string[];
  operate: typeof operateOutletDailyUsage;
  enabled?: boolean;
}): RequestHandler {
  const enabled = deps.enabled ?? DAILY_WEB_USAGE_ENABLED;
  return async (req, res, next) => {
    // Keep lifecycle handlers in place, but prevent even direct calls from
    // initializing or updating dailyUsage while the feature is disabled.
    if (!enabled && /^\/usage(?:\/|$)/.test(req.path)) {
      res.status(503).json({ success: false, code: 'USAGE_DISABLED', message: 'Daily Web Usage is temporarily disabled.' });
      return;
    }
    // These authenticated lifecycle endpoints must remain reachable after expiry/exhaustion.
    if (/^\/usage\/(initialize|start|heartbeat|stop|status)\/?$/.test(req.path)) { next(); return; }
    res.setHeader('Cache-Control', 'no-store');
    try {
      const token = deps.readToken(req);
      if (!token) throw new ProductCreationError(401, 'Your session has expired. Please sign in again.');
      const target = String(req.params.outletId ?? '');
      if (!enabled) {
        if (!target || target.length > 200 || target.includes('/') || target === '.' || target === '..') {
          throw new ProductCreationError(400, 'A valid outlet is required.');
        }
        const db = deps.db();
        const profile = (await db.collection('USER_PROFILE').doc(token.profileDocId).get()).data();
        requireProductOutlet(token.profileDocId, target, profile, deps.assigned);
        const outlet = await db.collection('OUTLET').doc(target).get();
        if (!outlet.exists) throw new ProductCreationError(404, 'Outlet not found.');
        if (outlet.data()?.active !== true) throw new ProductCreationError(403, 'This outlet is inactive.');
        next(); return;
      }
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
        code: error instanceof DailyUsageError ? error.code : enabled ? 'USAGE_UNAVAILABLE' : 'OUTLET_ACCESS_UNAVAILABLE',
        message: error instanceof ProductCreationError ? error.message : enabled
          ? 'Unable to verify Web POS usage. Access has not been granted.' : 'Unable to verify outlet access. Please try again.' });
    }
  };
}
