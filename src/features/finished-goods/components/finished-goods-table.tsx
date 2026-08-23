import { formatDate } from "@/lib/date";
import { formatMoney, formatUnitCost } from "@/lib/money";
import type { FinishedGoodsListRow } from "../types/finished-good";
import type {
  FinishedGoodsSortDirection,
  FinishedGoodsSortField,
} from "../hooks/use-finished-goods";
import { formatFinishedGoodsAvailable } from "../utils/format-finished-goods";
import { FinishedGoodsPagination } from "./finished-goods-pagination";

const COLUMN_COUNT = 5;

type FinishedGoodsTableProps = {
  items: FinishedGoodsListRow[];
  totalCount: number;
  filteredCount: number;
  hasActiveFilters: boolean;
  loading: boolean;
  error: string | null;
  sortField: FinishedGoodsSortField;
  sortDirection: FinishedGoodsSortDirection;
  page: number;
  totalPages: number;
  pageSize: number;
  onSort: (field: FinishedGoodsSortField) => void;
  onRetry: () => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
};

function TableSkeleton() {
  return (
    <>
      {Array.from({ length: 5 }).map((_, index) => (
        <tr key={index} className="border-t border-zinc-200">
          {Array.from({ length: COLUMN_COUNT }).map((__, cellIndex) => (
            <td key={cellIndex} className="px-4 py-4">
              <div className="h-4 animate-pulse rounded bg-zinc-200" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

function EmptyState({ hasActiveFilters }: { hasActiveFilters: boolean }) {
  return (
    <tr>
      <td colSpan={COLUMN_COUNT} className="px-4 py-16 text-center">
        <div className="mx-auto max-w-sm">
          <p className="text-base font-medium text-zinc-900">
            {hasActiveFilters
              ? "No matching finished goods"
              : "No finished goods yet"}
          </p>
          <p className="mt-2 text-sm text-zinc-500">
            {hasActiveFilters
              ? "Try a different product name."
              : "Complete a production session to create remaining finished goods."}
          </p>
        </div>
      </td>
    </tr>
  );
}

type SortableHeaderProps = {
  label: string;
  field: FinishedGoodsSortField;
  sortField: FinishedGoodsSortField;
  sortDirection: FinishedGoodsSortDirection;
  align?: "left" | "right";
  onSort: (field: FinishedGoodsSortField) => void;
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

export function FinishedGoodsTable({
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
  onSort,
  onRetry,
  onPageChange,
  onPageSizeChange,
}: FinishedGoodsTableProps) {
  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center">
        <p className="text-base font-medium text-red-800">
          Failed to load finished goods
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
                label="Product"
                field="product_name"
                sortField={sortField}
                sortDirection={sortDirection}
                onSort={onSort}
              />
              <SortableHeader
                label="Available Quantity"
                field="available_quantity"
                sortField={sortField}
                sortDirection={sortDirection}
                align="right"
                onSort={onSort}
              />
              <SortableHeader
                label="Avg Unit Cost"
                field="average_unit_cost"
                sortField={sortField}
                sortDirection={sortDirection}
                align="right"
                onSort={onSort}
              />
              <SortableHeader
                label="Remaining Value"
                field="remaining_value"
                sortField={sortField}
                sortDirection={sortDirection}
                align="right"
                onSort={onSort}
              />
              <SortableHeader
                label="Newest Batch"
                field="newest_batch_at"
                sortField={sortField}
                sortDirection={sortDirection}
                onSort={onSort}
              />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <TableSkeleton />
            ) : items.length === 0 ? (
              <EmptyState
                hasActiveFilters={hasActiveFilters && totalCount > 0}
              />
            ) : (
              items.map((item) => (
                <tr
                  key={item.product_id}
                  className="border-t border-zinc-200 transition-colors hover:bg-zinc-50"
                >
                  <td className="px-4 py-4 font-medium text-zinc-900">
                    {item.product_name ?? "—"}
                  </td>
                  <td className="px-4 py-4 text-right text-zinc-700">
                    {formatFinishedGoodsAvailable(
                      item.available_quantity,
                      item.yield_unit,
                    )}
                  </td>
                  <td className="px-4 py-4 text-right text-zinc-700">
                    {item.average_unit_cost === null
                      ? "—"
                      : formatUnitCost(item.average_unit_cost)}
                  </td>
                  <td className="px-4 py-4 text-right text-zinc-700">
                    {item.remaining_value === null
                      ? "—"
                      : formatMoney(item.remaining_value)}
                  </td>
                  <td className="px-4 py-4 text-zinc-700">
                    {formatDate(item.newest_batch_at)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {!loading && !error ? (
        <FinishedGoodsPagination
          page={page}
          totalPages={totalPages}
          pageSize={pageSize}
          filteredCount={filteredCount}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
        />
      ) : null}
    </div>
  );
}
