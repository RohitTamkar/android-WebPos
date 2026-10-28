import { clearMasterSnapshots } from './masterSnapshots.ts';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { UsageRequestError, WebUsageClient, WEB_USAGE_HEARTBEAT_MS, WEB_USAGE_IDLE_MS } from './webUsage.ts';

const pageIsHidden = () => document.visibilityState === 'hidden';
const exhausted = (error: unknown) => error instanceof UsageRequestError && error.code === 'USAGE_LIMIT_REACHED' && error.dailyLimitApplies !== false;
const failureMessage = (error: unknown) => error instanceof UsageRequestError && error.code === 'USAGE_LIMIT_REACHED' && error.dailyLimitApplies === false
  ? 'Your outlet session needs verification. Continue to reconnect.' : error instanceof Error ? error.message : 'Unable to verify usage. Please try again.';
const failurePolicy = (error: unknown, previous: boolean | null) => error instanceof UsageRequestError
  ? error.dailyLimitApplies ?? (exhausted(error) ? true : previous) : previous;

export function useWebUsage(token: string | undefined, outletId: string | undefined) {
  const [state, setState] = useState({ ready: false, key: '', message: '', blocked: false, suspended: false, silentResume: false, dailyLimitApplies: null as boolean | null, denied: null as 'account' | 'outlet' | null });
  const [attempt, setAttempt] = useState(0);
  const [authorizedKey, setAuthorizedKey] = useState('');
  const client = useRef<WebUsageClient | null>(null);
  const key = `${token}:${outletId}`;
  const recover = useRef<((error: UsageRequestError) => void) | null>(null);
  const verifiedPolicy = useRef<{ key: string; applies: boolean } | null>(null);
  useLayoutEffect(() => {
    const instance = new WebUsageClient(error => recover.current?.(error));
    client.current = instance;
    return instance.install();
  }, []);
  useEffect(() => {
    if (!token || !outletId) return;
    const instance = client.current!;
    let cancelled = false, paused = false, pending = false, resumeOnVisible = false, lastActivity = Date.now();
    let policy: boolean | null = verifiedPolicy.current?.key === key ? verifiedPolicy.current.applies : null;
    let recoveryTimer: number | undefined, recoveryDelay = 1000;
    const rememberPolicy = (value: boolean | undefined) => {
      if (typeof value === 'boolean') { policy = value; verifiedPolicy.current = { key, applies: value }; }
    };
    const scheduleRecovery = () => {
      if (cancelled || policy !== false) return;
      if (pageIsHidden()) { resumeOnVisible = true; return; }
      window.clearTimeout(recoveryTimer);
      recoveryTimer = window.setTimeout(() => {
        if (pending) scheduleRecovery(); else void start();
      }, recoveryDelay);
      recoveryDelay = Math.min(recoveryDelay * 2, 10_000);
    };
    const fail = (error: unknown) => {
      if (cancelled) return;
      paused = true;
      policy = failurePolicy(error, policy);
      if (policy !== null) rememberPolicy(policy);
      const denied = error instanceof UsageRequestError && error.status === 401 ? 'account'
        : policy !== true && error instanceof UsageRequestError && [403, 404].includes(error.status) && error.code !== 'USAGE_LIMIT_REACHED' ? 'outlet' : null;
      if (exhausted(error) || policy === false || denied) void instance.stop().catch(() => undefined);
      setState({ ready: false, suspended: false, silentResume: false, key, message: failureMessage(error),
        blocked: exhausted(error), dailyLimitApplies: policy, denied });
      if (!denied) scheduleRecovery();
    };
    recover.current = fail;
    const start = async () => {
      if (pending || cancelled) return;
      // A restored tab can mount while hidden. Remember the skipped start so
      // visibility return retries admission instead of leaving it pending forever.
      if (pageIsHidden()) { resumeOnVisible = true; return; }
      pending = true;
      try {
        const admission = await instance.start(token, outletId);
        if (!cancelled) {
          paused = false; recoveryDelay = 1000; window.clearTimeout(recoveryTimer);
          rememberPolicy(admission.dailyLimitApplies);
          setAuthorizedKey(key);
          setState({ ready: true, key, message: '', blocked: false, suspended: false, silentResume: false,
            dailyLimitApplies: policy, denied: null });
        }
      } catch (error) { paused = true; fail(error); }
      finally {
        pending = false;
        if (!cancelled && !paused && pageIsHidden()) void pause(true);
      }
    };
    const pause = async (hidden = false) => {
      if (paused || pending) return;
      paused = true;
      const silentResume = hidden && policy === false;
      resumeOnVisible = silentResume;
      // Native file pickers can hide the page. Keep its editor mounted while the
      // lease is released, then require a fresh server authorization on return.
      setState(current => ({ ready: false, key, message: silentResume ? '' : 'Web POS usage paused. Continue when you are ready.', blocked: false, silentResume,
        dailyLimitApplies: current.key === key ? current.dailyLimitApplies : null,
        suspended: hidden && current.key === key && (current.ready || current.suspended), denied: null }));
      try { await instance.stop(); } catch (error) {
        // Returning to an exempt tab can cancel a slow release in order to
        // reacquire its lease. Let that admission report any real failure.
        if (!(silentResume && pending && !pageIsHidden())) fail(error);
      }
      finally {
        if (!cancelled && resumeOnVisible && !pageIsHidden()) { resumeOnVisible = false; void start(); }
      }
    };
    const activity = () => { lastActivity = Date.now(); };
    const visibility = () => {
      if (pageIsHidden()) void pause(true);
      else if (resumeOnVisible) {
        lastActivity = Date.now(); resumeOnVisible = false; void start();
      }
    };
    const pagehide = () => instance.pagehide();
    void start();
    const timer = window.setInterval(() => {
      const exempt = policy === false;
      if (pageIsHidden() || (!exempt && Date.now() - lastActivity >= WEB_USAGE_IDLE_MS)) { void pause(pageIsHidden()); return; }
      if (paused || pending) return;
      pending = true;
      void instance.heartbeat().then(renewal => {
        if (!cancelled && renewal && typeof renewal.dailyLimitApplies === 'boolean') {
          rememberPolicy(renewal.dailyLimitApplies);
          setState(current => current.key === key ? { ...current, dailyLimitApplies: renewal.dailyLimitApplies! } : current);
        }
      }).catch(error => { paused = true; fail(error); }).finally(() => {
        pending = false;
        if (!cancelled && !paused && pageIsHidden()) void pause(true);
      });
    }, WEB_USAGE_HEARTBEAT_MS);
    for (const event of ['pointerdown', 'pointermove', 'keydown', 'scroll', 'touchstart']) window.addEventListener(event, activity, { passive: true });
    document.addEventListener('visibilitychange', visibility); window.addEventListener('focus', visibility); window.addEventListener('pagehide', pagehide);
    return () => {
      cancelled = true; window.clearInterval(timer); window.clearTimeout(recoveryTimer);
      if (recover.current === fail) recover.current = null;
      for (const event of ['pointerdown', 'pointermove', 'keydown', 'scroll', 'touchstart']) window.removeEventListener(event, activity);
      document.removeEventListener('visibilitychange', visibility); window.removeEventListener('focus', visibility); window.removeEventListener('pagehide', pagehide);
      // Serialize cleanup after any pending start/heartbeat; StrictMode re-entry reuses the same period.
      void instance.stop().catch(() => undefined);
    };
  }, [token, outletId, key, attempt]);
  const retry = () => {
    setState(current => ({ ...current, ready: false, message: '', blocked: false, suspended: false, silentResume: false, denied: null }));
    setAttempt(value => value + 1);
  };
  const release = useCallback(() => {
    // Leaving an outlet requires fresh admission even when it is selected again.
    setAuthorizedKey(''); verifiedPolicy.current = null; clearMasterSnapshots();
    setState({ ready: false, key: '', message: '', blocked: false, suspended: false, silentResume: false, dailyLimitApplies: null, denied: null });
    return client.current?.stop() ?? Promise.resolve();
  }, []);
  // Admission history preserves mounted editors during lease recovery; it never
  // authorizes a request. WebUsageClient and the server still require a live lease.
  return { authorized: authorizedKey === key,
    ready: state.key === key && state.ready,
    message: state.key === key ? state.message : '',
    denied: state.key === key ? state.denied : null,
    blocked: state.key === key && state.blocked && state.dailyLimitApplies !== false,
    dailyLimitApplies: state.key === key ? state.dailyLimitApplies : null,
    silentResume: state.key === key && state.silentResume && state.dailyLimitApplies === false,
    suspended: state.key === key && state.suspended, release, retry };
}
