import type { SearchResult } from "../types/search";
import { SearchEntityBadge } from "./search-entity-badge";

type SearchResultsDropdownProps = {
  open: boolean;
  loading: boolean;
  error: string | null;
  hasSearched: boolean;
  results: SearchResult[];
  query: string;
  minQueryLength: number;
  onSelect: (item: SearchResult) => void;
};

/**
 * Presentational search results dropdown.
 * Renders SearchResult fields as returned — no client-side filtering.
 */
export function SearchResultsDropdown({
  open,
  loading,
  error,
  hasSearched,
  results,
  query,
  minQueryLength,
  onSelect,
}: SearchResultsDropdownProps) {
  if (!open) {
    return null;
  }

  const trimmed = query.trim();
  const belowMin = trimmed.length > 0 && trimmed.length < minQueryLength;

  return (
    <div
      className="absolute left-0 right-0 top-full z-50 mt-2 max-h-96 overflow-y-auto rounded-xl border border-zinc-200 bg-white shadow-lg"
      role="listbox"
      aria-label="Search results"
    >
      {belowMin ? (
        <p className="px-4 py-3 text-sm text-zinc-500">
          Type at least {minQueryLength} characters to search.
        </p>
      ) : null}

      {!belowMin && loading ? (
        <p className="px-4 py-3 text-sm text-zinc-500" role="status">
          Searching…
        </p>
      ) : null}

      {!belowMin && !loading && error ? (
        <p className="px-4 py-3 text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}

      {!belowMin && !loading && !error && hasSearched && results.length === 0 ? (
        <div className="px-4 py-6 text-center">
          <p className="text-sm font-medium text-zinc-900">No results</p>
          <p className="mt-1 text-sm text-zinc-500">
            Nothing matched “{trimmed}”.
          </p>
        </div>
      ) : null}

      {!belowMin && !loading && !error && results.length > 0 ? (
        <ul className="divide-y divide-zinc-100 py-1">
          {results.map((item) => (
            <li key={`${item.entityType}:${item.entityId}`} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={false}
                className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left hover:bg-zinc-50 focus:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-500/40"
                onClick={() => onSelect(item)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    onSelect(item);
                  }
                }}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-zinc-900">
                    {item.title}
                  </p>
                  {item.subtitle ? (
                    <p className="mt-0.5 truncate text-sm text-zinc-500">
                      {item.subtitle}
                    </p>
                  ) : null}
                  {item.code ? (
                    <p className="mt-0.5 truncate font-mono text-xs text-zinc-500">
                      {item.code}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <SearchEntityBadge entityType={item.entityType} />
                  {item.status ? (
                    <span className="text-xs text-zinc-500">{item.status}</span>
                  ) : null}
                </div>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
