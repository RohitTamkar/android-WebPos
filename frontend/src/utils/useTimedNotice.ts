import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';

export const NOTICE_DURATION_MS = 10_000;

// Each notification gets a fresh lifetime, even when its text repeats.
export function useTimedNotice(autoDismiss = true): [string, Dispatch<SetStateAction<string>>] {
  const [notice, setNotice] = useState({ text: '', revision: 0 });
  const update = useCallback<Dispatch<SetStateAction<string>>>(value => {
    setNotice(current => ({ text: typeof value === 'function' ? value(current.text) : value, revision: current.revision + 1 }));
  }, []);
  useEffect(() => {
    if (!notice.text || !autoDismiss) return;
    const timer = window.setTimeout(() => setNotice(current => current.revision === notice.revision
      ? { text: '', revision: current.revision + 1 } : current), NOTICE_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [notice, autoDismiss]);
  return [notice.text, update];
}

// Dialogs retain their existing OK/close action and also dismiss after ten seconds.
export function useSuccessDismiss(message: string, onDismiss: () => void) {
  const dismiss = useRef(onDismiss);
  useEffect(() => { dismiss.current = onDismiss; }, [dismiss, onDismiss]);
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => dismiss.current(), NOTICE_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [message, dismiss]);
}
