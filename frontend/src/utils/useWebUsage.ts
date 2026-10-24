import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { UsageRequestError, WebUsageClient, WEB_USAGE_HEARTBEAT_MS, WEB_USAGE_IDLE_MS } from './webUsage.ts';
import { DAILY_WEB_USAGE_ENABLED } from './featureFlags.ts';

export function useWebUsage(token: string | undefined, outletId: string | undefined) {
  const [state, setState] = useState({ ready: false, key: '', message: '', blocked: false, suspended: false });
  const [attempt, setAttempt] = useState(0);
  const [authorizedKey, setAuthorizedKey] = useState('');
  const client = useRef<WebUsageClient | null>(null);
  const key = `${token}:${outletId}`;
  useLayoutEffect(() => {
    if (!DAILY_WEB_USAGE_ENABLED) return;
    const instance = new WebUsageClient(error => {
      setState(current => ({ ...current, ready: false, suspended: false, message: error.message, blocked: error.code === 'USAGE_LIMIT_REACHED' }));
    });
    client.current = instance;
    return instance.install();
  }, []);
  useEffect(() => {
    if (!DAILY_WEB_USAGE_ENABLED || !token || !outletId) return;
    const instance = client.current!;
    let cancelled = false, paused = false, pending = false, resumeOnVisible = false, lastActivity = Date.now();
    const fail = (error: unknown) => {
      if (!cancelled) setState({ ready: false, suspended: false, key, message: error instanceof Error ? error.message : 'Unable to verify usage. Please try again.',
        blocked: error instanceof UsageRequestError && error.code === 'USAGE_LIMIT_REACHED' });
    };
    const start = async () => {
      if (pending || cancelled) return;
      // A restored tab can mount while hidden. Remember the skipped start so
      // visibility return retries admission instead of leaving it pending forever.
      if (document.visibilityState === 'hidden') { resumeOnVisible = true; return; }
      pending = true;
      try {
        await instance.start(token, outletId);
        if (!cancelled) {
          paused = false;
          setAuthorizedKey(key);
          setState({ ready: true, key, message: '', blocked: false, suspended: false });
        }
      } catch (error) { paused = true; fail(error); }
      finally { pending = false; }
    };
    const pause = async (hidden = false) => {
      if (paused || pending) return;
      paused = true;
      resumeOnVisible = hidden;
      // Native file pickers can hide the page. Keep its editor mounted while the
      // lease is released, then require a fresh server authorization on return.
      setState(current => ({ ready: false, key, message: 'Web POS usage paused. Continue when you are ready.', blocked: false,
        suspended: hidden && current.key === key && (current.ready || current.suspended) }));
      try { await instance.stop(); } catch (error) { fail(error); }
      finally { if (resumeOnVisible && document.visibilityState !== 'hidden') { resumeOnVisible = false; void start(); } }
    };
    const activity = () => { lastActivity = Date.now(); };
    const visibility = () => {
      if (document.visibilityState === 'hidden') void pause(true);
      else if (resumeOnVisible) {
        lastActivity = Date.now(); resumeOnVisible = false; void start();
      }
    };
    const pagehide = () => instance.pagehide();
    void start();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'hidden' || Date.now() - lastActivity >= WEB_USAGE_IDLE_MS) { void pause(document.visibilityState === 'hidden'); return; }
      if (paused || pending) return;
      pending = true;
      void instance.heartbeat().catch(error => { paused = true; fail(error); }).finally(() => { pending = false; });
    }, WEB_USAGE_HEARTBEAT_MS);
    for (const event of ['pointerdown', 'pointermove', 'keydown', 'scroll', 'touchstart']) window.addEventListener(event, activity, { passive: true });
    document.addEventListener('visibilitychange', visibility); window.addEventListener('pagehide', pagehide);
    return () => {
      cancelled = true; window.clearInterval(timer);
      for (const event of ['pointerdown', 'pointermove', 'keydown', 'scroll', 'touchstart']) window.removeEventListener(event, activity);
      document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', pagehide);
      // Serialize cleanup after any pending start/heartbeat; StrictMode re-entry reuses the same period.
      void instance.stop().catch(() => undefined);
    };
  }, [token, outletId, key, attempt]);
  const retry = () => {
    setState(current => ({ ...current, ready: false, message: '', blocked: false, suspended: false }));
    setAttempt(value => value + 1);
  };
  const release = useCallback(() => {
    // Leaving an outlet requires fresh admission even when it is selected again.
    setAuthorizedKey('');
    setState({ ready: false, key: '', message: '', blocked: false, suspended: false });
    return client.current?.stop() ?? Promise.resolve();
  }, []);
  // Admission history preserves mounted editors during lease recovery; it never
  // authorizes a request. WebUsageClient and the server still require a live lease.
  return { authorized: !DAILY_WEB_USAGE_ENABLED || authorizedKey === key,
    ready: !DAILY_WEB_USAGE_ENABLED || (state.key === key && state.ready),
    message: DAILY_WEB_USAGE_ENABLED && state.key === key ? state.message : '',
    blocked: DAILY_WEB_USAGE_ENABLED && state.key === key && state.blocked,
    suspended: DAILY_WEB_USAGE_ENABLED && state.key === key && state.suspended, release, retry };
}
