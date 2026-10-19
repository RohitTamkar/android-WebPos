import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { UsageRequestError, WebUsageClient, WEB_USAGE_HEARTBEAT_MS, WEB_USAGE_IDLE_MS } from './webUsage.ts';

export function useWebUsage(token: string | undefined, outletId: string | undefined) {
  const [state, setState] = useState({ ready: false, key: '', message: '', blocked: false });
  const [attempt, setAttempt] = useState(0);
  const client = useRef<WebUsageClient | null>(null);
  const key = `${token}:${outletId}`;
  useLayoutEffect(() => {
    const instance = new WebUsageClient(error => {
      setState(current => ({ ...current, ready: false, message: error.message, blocked: error.code === 'USAGE_LIMIT_REACHED' }));
    });
    client.current = instance;
    return instance.install();
  }, []);
  useEffect(() => {
    if (!token || !outletId) return;
    const instance = client.current!;
    let cancelled = false, paused = false, pending = false, lastActivity = Date.now();
    const fail = (error: unknown) => {
      if (!cancelled) setState({ ready: false, key, message: error instanceof Error ? error.message : 'Unable to verify usage. Please try again.',
        blocked: error instanceof UsageRequestError && error.code === 'USAGE_LIMIT_REACHED' });
    };
    const start = async () => {
      if (pending || cancelled || document.visibilityState === 'hidden') return;
      pending = true;
      try {
        await instance.start(token, outletId);
        if (!cancelled) { paused = false; setState({ ready: true, key, message: '', blocked: false }); }
      } catch (error) { paused = true; fail(error); }
      finally { pending = false; }
    };
    const pause = async () => {
      if (paused || pending) return;
      paused = true;
      setState({ ready: false, key, message: 'Web POS usage paused. Continue when you are ready.', blocked: false });
      try { await instance.stop(); } catch (error) { fail(error); }
    };
    const activity = () => { lastActivity = Date.now(); };
    const visibility = () => { if (document.visibilityState === 'hidden') void pause(); };
    const pagehide = () => instance.pagehide();
    void start();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'hidden' || Date.now() - lastActivity >= WEB_USAGE_IDLE_MS) { void pause(); return; }
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
    setState(current => ({ ...current, ready: false, message: '', blocked: false }));
    setAttempt(value => value + 1);
  };
  const release = useCallback(() => client.current?.stop() ?? Promise.resolve(), []);
  return { ready: state.key === key && state.ready, message: state.key === key ? state.message : '',
    blocked: state.key === key && state.blocked, release, retry };
}
