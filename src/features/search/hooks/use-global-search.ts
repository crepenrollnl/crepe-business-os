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
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

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

  useEffect(() => {
    const trimmed = query.trim();

    if (trimmed.length < MIN_QUERY_LENGTH) {
      setResults([]);
      setError(null);
      setLoading(false);
      setHasSearched(false);
      return;
    }

    setLoading(true);
    const timer = window.setTimeout(() => {
      void runSearch(query);
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [query, runSearch]);

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
