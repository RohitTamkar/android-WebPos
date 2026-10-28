import { useCallback, useEffect, useRef, useState } from 'react';

// Store only a validated screen name in browser history. Authentication and
// outlet admission remain in their existing state and are never restored here.
export function useBrowserHistoryState<T extends string>(key: string, initial: T, valid: (value: unknown) => value is T) {
  const [value, setValue] = useState<T>(() => valid(window.history.state?.[key]) ? window.history.state[key] : initial);
  const backPending = useRef(false);
  useEffect(() => {
    if (!valid(window.history.state?.[key])) {
      window.history.replaceState({ ...window.history.state, [key]: initial }, '');
    }
    const restore = (event: PopStateEvent) => {
      backPending.current = false;
      setValue(valid(event.state?.[key]) ? event.state[key] : initial);
    };
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, [key, initial, valid]);

  const navigate = useCallback((next: T) => {
    if (!valid(next)) return;
    if (window.history.state?.[key] !== next) {
      window.history.pushState({ ...window.history.state, [key]: next }, '');
    }
    setValue(next);
  }, [key, valid]);
  const back = useCallback(() => {
    if (backPending.current) return;
    const current = window.history.state?.[key];
    if (valid(current) && current !== initial) { backPending.current = true; window.history.back(); }
    else setValue(initial);
  }, [key, initial, valid]);
  return [value, navigate, back] as const;
}
