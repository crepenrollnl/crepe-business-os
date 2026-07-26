import type {
  ProductionPlanListItem,
  ProductionSortDirection,
  ProductionSortField,
} from "../types/production";
import { ProductionRow } from "./production-row";

type ProductionTableProps = {
  items: ProductionPlanListItem[];
  totalCount: number;
  hasActiveFilters: boolean;
  loading: boolean;
  error: string | null;
  sortField: ProductionSortField;
  sortDirection: ProductionSortDirection;
  highlightedPlanId?: string | null;
  onSort: (field: ProductionSortField) => void;
  onRetry: () => void;
  onCreateClick: () => void;
  onOpen: (item: ProductionPlanListItem) => void;
};

function ProductionTableSkeleton() {
  return (
    <>
      {Array.from({ length: 5 }).map((_, index) => (
        <tr key={index} className="border-t border-zinc-200">
          {Array.from({ length: 7 }).map((__, cellIndex) => (
            <td key={cellIndex} className="px-4 py-4">
              <div className="h-4 animate-pulse rounded bg-zinc-200" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

type ProductionEmptyStateProps = {
  hasActiveFilters: boolean;
  onCreateClick: () => void;
};

function ProductionEmptyState({
  hasActiveFilters,
  onCreateClick,
}: ProductionEmptyStateProps) {
  return (
    <tr>
      <td colSpan={7} className="px-4 py-16 text-center">
        <div className="mx-auto max-w-sm">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-50 text-amber-600">
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="h-7 w-7"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
              />
            </svg>
          </div>
          <p className="mt-4 text-base font-medium text-zinc-900">
            {hasActiveFilters
              ? "No matching production plans"
              : "No Production Plans"}
          </p>
          <p className="mt-2 text-sm text-zinc-500">
            {hasActiveFilters
              ? "Try adjusting your search or status filter."
              : "Create your first Production Plan to begin production planning."}
          </p>
          {!hasActiveFilters && (
            <button
              type="button"
              onClick={onCreateClick}
              className="mt-6 inline-flex items-center justify-center rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-amber-600"
            >
              Create Production Plan
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

type SortableHeaderProps = {
  label: string;
  field: ProductionSortField;
  sortField: ProductionSortField;
  sortDirection: ProductionSortDirection;
  align?: "left" | "right";
  onSort: (field: ProductionSortField) => void;
};

function SortableHeader({
  label,
  field,
  sortField,
  sortDirection,
  align = "left",
  onSort,
}: SortableHeaderProps) {
  const isActive = sortField === field;
  const ariaSort = isActive
    ? sortDirection === "asc"
      ? "ascending"
      : "descending"
    : "none";

  return (
    <th
      aria-sort={ariaSort}
      className={`px-4 py-3 text-sm font-semibold text-zinc-700 ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      <button
        type="button"
        onClick={() => onSort(field)}
        className={`inline-flex items-center gap-1.5 rounded-md transition-colors hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30 ${
          align === "right" ? "flex-row-reverse" : ""
        } ${isActive ? "text-zinc-900" : "text-zinc-700"}`}
      >
        <span>{label}</span>
        <span
          aria-hidden="true"
          className={`text-xs ${isActive ? "text-amber-600" : "text-zinc-400"}`}
        >
          {isActive ? (sortDirection === "asc" ? "↑" : "↓") : "↕"}
        </span>
      </button>
    </th>
  );
}

export function ProductionTable({
  items,
  totalCount,
  hasActiveFilters,
  loading,
  error,
  sortField,
  sortDirection,
  highlightedPlanId = null,
  onSort,
  onRetry,
  onCreateClick,
  onOpen,
}: ProductionTableProps) {
  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center">
        <p className="text-base font-medium text-red-800">
          Failed to load production plans
        </p>
        <p className="mt-2 text-sm text-red-600">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-6 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="min-w-full">
          <thead className="bg-zinc-50">
            <tr>
              <SortableHeader
                label="Name"
                field="name"
                sortField={sortField}
                sortDirection={sortDirection}
                onSort={onSort}
              />
              <SortableHeader
                label="Status"
                field="status"
                sortField={sortField}
                sortDirection={sortDirection}
                onSort={onSort}
              />
              <SortableHeader
                label="Planned Date"
                field="planning_date"
                sortField={sortField}
                sortDirection={sortDirection}
                onSort={onSort}
              />
              <th className="px-4 py-3 text-right text-sm font-semibold text-zinc-700">
                Products
              </th>
              <SortableHeader
                label="Created"
                field="created_at"
                sortField={sortField}
                sortDirection={sortDirection}
                onSort={onSort}
              />
              <SortableHeader
                label="Updated"
                field="updated_at"
                sortField={sortField}
                sortDirection={sortDirection}
                onSort={onSort}
              />
              <th className="px-4 py-3 text-right text-sm font-semibold text-zinc-700">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <ProductionTableSkeleton />
            ) : items.length === 0 ? (
              <ProductionEmptyState
                hasActiveFilters={hasActiveFilters && totalCount > 0}
                onCreateClick={onCreateClick}
              />
            ) : (
              items.map((item) => (
                <ProductionRow
                  key={item.id}
                  item={item}
                  highlighted={item.id === highlightedPlanId}
                  onOpen={onOpen}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
