"use client";

import { useCallback, useEffect, useState } from "react";
import { globalSearchService } from "../services/global-search-service";
import type { SearchResult } from "../types/search";

const SEARCH_DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;

/**
 * Global Search UI orchestration (DEV-047).
 * Debounces input and loads results only via globalSearchService.search.
 */
export function useGlobalSearch() {
  const [query, setQuery] = useState("");
  const [rawResults, setResults] = useState<SearchResult[]>([]);
  const [rawLoading, setLoading] = useState(false);
  const [rawError, setError] = useState<string | null>(null);
  const [rawHasSearched, setHasSearched] = useState(false);

  const runSearch = useCallback(async (value: string) => {
    const trimmed = value.trim();

    if (trimmed.length < MIN_QUERY_LENGTH) {
      setResults([]);
      setError(null);
      setLoading(false);
      setHasSearched(false);
      return;
    }

    setLoading(true);
    setError(null);

    const result = await globalSearchService.search(trimmed);

    if (result.error || !result.data) {
      setResults([]);
      setError(result.error ?? "Failed to search");
      setLoading(false);
      setHasSearched(true);
      return;
    }

    setResults(result.data);
    setError(null);
    setLoading(false);
    setHasSearched(true);
  }, []);

  // Below MIN_QUERY_LENGTH there is nothing to search — derived directly
  // from `query` at render time rather than reset via effect.
  const isQueryTooShort = query.trim().length < MIN_QUERY_LENGTH;

  useEffect(() => {
    if (isQueryTooShort) {
      return;
    }

    // Marks the start of the debounce+search subscription below, not
    // derived state — there's no render-time value "pending search" can
    // come from.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    const timer = window.setTimeout(() => {
      void runSearch(query);
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [isQueryTooShort, query, runSearch]);

  const results = isQueryTooShort ? [] : rawResults;
  const error = isQueryTooShort ? null : rawError;
  const loading = !isQueryTooShort && rawLoading;
  const hasSearched = !isQueryTooShort && rawHasSearched;

  const clear = useCallback(() => {
    setQuery("");
    setResults([]);
    setError(null);
    setLoading(false);
    setHasSearched(false);
  }, []);

  return {
    query,
    setQuery,
    results,
    loading,
    error,
    hasSearched,
    minQueryLength: MIN_QUERY_LENGTH,
    clear,
  };
}
