"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SearchInput } from "./search-input";
import { SearchResultsDropdown } from "./search-results-dropdown";
import { useGlobalSearch } from "../hooks/use-global-search";
import { getSearchResultHref } from "../utils/search-result-href";
import type { SearchResult } from "../types/search";

/**
 * Global search control: input + results dropdown + navigation.
 */
export function GlobalSearch() {
  const router = useRouter();
  const {
    query,
    setQuery,
    results,
    loading,
    error,
    hasSearched,
    minQueryLength,
    clear,
  } = useGlobalSearch();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        clear();
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [clear]);

  const showDropdown =
    open &&
    (query.trim().length > 0 || loading || error !== null || hasSearched);

  const handleSelect = (item: SearchResult) => {
    const href = getSearchResultHref(item.entityType, item.entityId);
    setOpen(false);
    clear();
    router.push(href);
  };

  return (
    <div ref={containerRef} className="relative w-full max-w-xl">
      <SearchInput
        value={query}
        onChange={(value) => {
          setQuery(value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        minQueryLength={minQueryLength}
      />
      <SearchResultsDropdown
        open={showDropdown}
        loading={loading}
        error={error}
        hasSearched={hasSearched}
        results={results}
        query={query}
        minQueryLength={minQueryLength}
        onSelect={handleSelect}
      />
    </div>
  );
}
