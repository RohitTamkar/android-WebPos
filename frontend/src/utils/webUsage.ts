// Activity pauses after 60 seconds, sampled every 10 seconds. Hidden pages release immediately.
import { createRequestId } from './requestId.ts';

export const WEB_USAGE_HEARTBEAT_MS = 10_000;
export const WEB_USAGE_IDLE_MS = 60_000;
export interface UsageSession {
  outletId: string; generation: string; sessionId: string; sequence: number;
  usedSeconds: number; remainingSeconds: number; date: string; timeZone: string;
}
export class UsageRequestError extends Error {
  code: string; status: number;
  constructor(message: string, code: string, status: number) { super(message); this.code = code; this.status = status; }
}

// One client per mounted App; all page fetch calls retain their existing auth/error handling.
export class WebUsageClient {
  session: UsageSession | null = null;
  private token = '';
  private outletId = '';
  private queue: Promise<unknown> = Promise.resolve();
  private original: typeof fetch;
  private active = true;
  private requestId = '';
  private inFlight: AbortController | null = null;
  private revision = 0;
  private notify: (error: UsageRequestError) => void;
  constructor(notify: (error: UsageRequestError) => void) { this.notify = notify; this.original = window.fetch.bind(window); }
  install() {
    const wrapped: typeof fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input), window.location.origin);
      if (!this.active || url.origin !== window.location.origin || !/^\/api\/outlets\//.test(url.pathname) || /\/usage\//.test(url.pathname)) return this.original(input, init);
      // A visible page may still be reacquiring its lease after the device picker
      // closes. Wait for that lifecycle operation before sending an outlet request.
      if (!this.session) await this.queue;
      const session = this.session;
      if (!session) return Response.json({ success: false, code: 'USAGE_SESSION_REQUIRED', message: 'Resume Web POS to continue.' }, { status: 428 });
      const headers = new Headers(input instanceof Request ? input.headers : undefined);
      new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
      headers.set('X-Web-Usage-Outlet', session.outletId);
      headers.set('X-Web-Usage-Session', session.sessionId);
      headers.set('X-Web-Usage-Generation', session.generation);
      const response = await this.original(input, { ...init, headers });
      if (!response.ok) {
        const body = await response.clone().json().catch(() => null) as { code?: string; message?: string } | null;
        if (this.active && this.session?.sessionId === session.sessionId && this.session?.generation === session.generation && body?.code?.startsWith('USAGE_')) { this.session = null; this.notify(new UsageRequestError(body.message || 'Unable to verify usage.', body.code, response.status)); }
      }
      return response;
    };
    window.fetch = wrapped;
    return () => { this.active = false; if (window.fetch === wrapped) window.fetch = this.original; };
  }
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation); this.queue = result.catch(() => undefined); return result;
  }
  private async request(action: string, body: object, token = this.token, outletId = this.outletId, keepalive = false) {
    const controller = new AbortController();
    this.inFlight = controller;
    const timeout = window.setTimeout(() => controller.abort(), action === 'stop' ? 5000 : 10000);
    let rejectAbort: () => void = () => undefined;
    try {
      const aborted = new Promise<never>((_, reject) => {
        rejectAbort = () => reject(new UsageRequestError('Unable to verify Web POS usage. Check your connection and retry.', 'USAGE_UNAVAILABLE', 503));
        controller.signal.addEventListener('abort', rejectAbort, { once: true });
      });
      // Bound both the fetch and response body. Some stalled connections return headers but never finish JSON.
      return await Promise.race([aborted, (async () => {
        const response = await this.original(`/api/outlets/${encodeURIComponent(outletId)}/usage/${action}`, {
          method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body), cache: 'no-store', keepalive, signal: controller.signal,
        });
        const payload = await response.json() as { success?: boolean; message?: string; code?: string; data?: UsageSession };
        if (!response.ok || !payload.success || !payload.data) throw new UsageRequestError(payload.message || 'Unable to verify Web POS usage.', payload.code || 'USAGE_UNAVAILABLE', response.status);
        return payload.data;
      })()]);
    } catch (error) {
      if (error instanceof UsageRequestError) throw error;
      throw new UsageRequestError('Unable to verify Web POS usage. Check your connection and retry.', 'USAGE_UNAVAILABLE', 503);
    } finally {
      window.clearTimeout(timeout); controller.signal.removeEventListener('abort', rejectAbort);
      if (this.inFlight === controller) this.inFlight = null;
    }
  }
  start(token: string, outletId: string) {
    const revision = this.revision;
    return this.serialize(async () => {
      if (revision !== this.revision) throw new UsageRequestError('Usage request cancelled.', 'USAGE_CANCELLED', 409);
      if (this.session && (this.token !== token || this.outletId !== outletId)) await this.stopCurrent();
      this.token = token; this.outletId = outletId;
      // Persist only a random idempotency key, never a counter or activity timestamp.
      const key = `pos_web_usage:${outletId}`;
      try { this.requestId = sessionStorage.getItem(key) || createRequestId(); sessionStorage.setItem(key, this.requestId); }
      catch { this.requestId ||= createRequestId(); }
      const data = await this.request('start', { requestId: this.requestId });
      if (!data.sessionId || !data.generation || data.outletId !== outletId) throw new UsageRequestError('Invalid usage authorization response.', 'USAGE_UNAVAILABLE', 503);
      this.session = data; return data;
    });
  }
  heartbeat() {
    const revision = this.revision;
    return this.serialize(async () => {
      if (revision !== this.revision) return;
      const session = this.session; if (!session) return;
      const data = await this.request('heartbeat', { sessionId: session.sessionId, generation: session.generation, sequence: session.sequence + 1 });
      this.session = data; return data;
    });
  }
  private async stopCurrent() {
    const session = this.session; this.session = null;
    if (!session) return;
    try { await this.request('stop', { sessionId: session.sessionId, generation: session.generation, sequence: session.sequence }, this.token, session.outletId, true); }
    finally {
      try { if (this.active) sessionStorage.removeItem(`pos_web_usage:${session.outletId}`); } catch { /* Lease expiry bounds failures. */ }
      this.requestId = '';
    }
  }
  stop() {
    this.revision++;
    this.inFlight?.abort();
    return this.serialize(() => this.stopCurrent());
  }
  pagehide() {
    // Keep the resume key across refresh; settle/release the lease with a keepalive request.
    const session = this.session;
    if (session) void this.request('stop', { sessionId: session.sessionId, generation: session.generation, sequence: session.sequence }, this.token, session.outletId, true).catch(() => undefined);
  }
}
