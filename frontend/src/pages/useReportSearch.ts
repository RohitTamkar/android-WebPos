import { useEffect, type Dispatch, type SetStateAction } from 'react';

export function useReportSearch<T extends { search: string }>(
  search: string,
  appliedSearch: string,
  setAppliedFilters: Dispatch<SetStateAction<T>>,
  setPage?: Dispatch<SetStateAction<number>>,
) {
  useEffect(() => {
    const query = search.trim();
    if (query === appliedSearch.trim()) return;
    const timer = window.setTimeout(() => {
      setPage?.(1);
      // Search updates preserve the other filters that are already applied.
      setAppliedFilters(current => ({ ...current, search: query }));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search, appliedSearch, setAppliedFilters, setPage]);
}
