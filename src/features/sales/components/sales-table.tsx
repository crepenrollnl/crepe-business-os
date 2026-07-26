import type { SaleListItem } from "../types/sale";
import type {
  SaleSortDirection,
  SaleSortField,
} from "../hooks/use-sales";
import { SaleRow } from "./sale-row";
import { SalesPagination } from "./sales-pagination";

type SalesTableProps = {
  items: SaleListItem[];
  totalCount: number;
  filteredCount: number;
  hasActiveFilters: boolean;
  loading: boolean;
  error: string | null;
  sortField: SaleSortField;
  sortDirection: SaleSortDirection;
  page: number;
  totalPages: number;
  pageSize: number;
  creating: boolean;
  onSort: (field: SaleSortField) => void;
  onRetry: () => void;
  onOpen: (item: SaleListItem) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  onCreateClick: () => void;
};

function SalesTableSkeleton() {
  return (
    <>
      {Array.from({ length: 5 }).map((_, index) => (
        <tr key={index} className="border-t border-zinc-200">
          {Array.from({ length: 8 }).map((__, cellIndex) => (
            <td key={cellIndex} className="px-4 py-4">
              <div className="h-4 animate-pulse rounded bg-zinc-200" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

function EmptyStateIcon() {
  return (
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
          d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"
        />
      </svg>
    </div>
  );
}

type SalesEmptyStateProps = {
  hasActiveFilters: boolean;
  creating: boolean;
  onCreateClick: () => void;
};

function SalesEmptyState({
  hasActiveFilters,
  creating,
  onCreateClick,
}: SalesEmptyStateProps) {
  return (
    <tr>
      <td colSpan={8} className="px-4 py-16 text-center">
        <div className="mx-auto max-w-sm">
          <EmptyStateIcon />
          <p className="mt-4 text-base font-medium text-zinc-900">
            {hasActiveFilters ? "No matching sales" : "No sales yet"}
          </p>
          <p className="mt-2 text-sm text-zinc-500">
            {hasActiveFilters
              ? "Try adjusting your search or status filter."
              : "Create a draft sale to start adding products and confirming orders."}
          </p>
          {!hasActiveFilters ? (
            <button
              type="button"
              onClick={onCreateClick}
              disabled={creating}
              className="mt-6 inline-flex items-center justify-center rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {creating ? "Creating..." : "+ New Sale"}
            </button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

type SortableHeaderProps = {
  label: string;
  field: SaleSortField;
  sortField: SaleSortField;
  sortDirection: SaleSortDirection;
  align?: "left" | "right";
  onSort: (field: SaleSortField) => void;
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

export function SalesTable({
  items,
  totalCount,
  filteredCount,
  hasActiveFilters,
  loading,
  error,
  sortField,
  sortDirection,
  page,
  totalPages,
  pageSize,
  creating,
  onSort,
  onRetry,
  onOpen,
  onPageChange,
  onPageSizeChange,
  onCreateClick,
}: SalesTableProps) {
  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center">
        <p className="text-base font-medium text-red-800">
          Failed to load sales
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
                label="Sale Number"
                field="sale_number"
                sortField={sortField}
                sortDirection={sortDirection}
                onSort={onSort}
              />
              <SortableHeader
                label="Date"
                field="sale_date"
                sortField={sortField}
                sortDirection={sortDirection}
                onSort={onSort}
              />
              <th className="px-4 py-3 text-left text-sm font-semibold text-zinc-700">
                Customer
              </th>
              <SortableHeader
                label="Status"
                field="status"
                sortField={sortField}
                sortDirection={sortDirection}
                onSort={onSort}
              />
              <th className="px-4 py-3 text-right text-sm font-semibold text-zinc-700">
                Subtotal
              </th>
              <th className="px-4 py-3 text-right text-sm font-semibold text-zinc-700">
                Tax
              </th>
              <SortableHeader
                label="Total"
                field="total"
                sortField={sortField}
                sortDirection={sortDirection}
                align="right"
                onSort={onSort}
              />
              <th className="px-4 py-3 text-right text-sm font-semibold text-zinc-700">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <SalesTableSkeleton />
            ) : items.length === 0 ? (
              <SalesEmptyState
                hasActiveFilters={hasActiveFilters && totalCount > 0}
                creating={creating}
                onCreateClick={onCreateClick}
              />
            ) : (
              items.map((item) => (
                <SaleRow key={item.sale_id} item={item} onOpen={onOpen} />
              ))
            )}
          </tbody>
        </table>
      </div>

      {!loading && !error && (
        <SalesPagination
          page={page}
          totalPages={totalPages}
          pageSize={pageSize}
          filteredCount={filteredCount}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
        />
      )}
    </div>
  );
}
