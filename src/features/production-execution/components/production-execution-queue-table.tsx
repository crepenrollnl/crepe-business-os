import type {
  ExecutableProductionPlan,
  ProductionExecutionSortDirection,
  ProductionExecutionSortField,
} from "../types/production-execution";
import { ProductionExecutionQueueRow } from "./production-execution-queue-row";

type ProductionExecutionQueueTableProps = {
  items: ExecutableProductionPlan[];
  loading: boolean;
  error: string | null;
  sortField: ProductionExecutionSortField;
  sortDirection: ProductionExecutionSortDirection;
  onSort: (field: ProductionExecutionSortField) => void;
  onRetry: () => void;
  onOpen: (item: ExecutableProductionPlan) => void;
};

function QueueTableSkeleton() {
  return (
    <>
      {Array.from({ length: 5 }).map((_, index) => (
        <tr key={index} className="border-t border-zinc-200">
          {Array.from({ length: 6 }).map((__, cellIndex) => (
            <td key={cellIndex} className="px-4 py-4">
              <div className="h-4 animate-pulse rounded bg-zinc-200" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

function QueueEmptyState() {
  return (
    <tr>
      <td colSpan={6} className="px-4 py-16 text-center">
        <div className="mx-auto max-w-md">
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
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"
              />
            </svg>
          </div>
          <p className="mt-4 text-base font-medium text-zinc-900">
            No Production Plans Ready
          </p>
          <p className="mt-2 text-sm text-zinc-500">
            Complete production planning and calculate requirements before
            executing production.
          </p>
        </div>
      </td>
    </tr>
  );
}

type SortableHeaderProps = {
  label: string;
  field: ProductionExecutionSortField;
  sortField: ProductionExecutionSortField;
  sortDirection: ProductionExecutionSortDirection;
  align?: "left" | "right";
  onSort: (field: ProductionExecutionSortField) => void;
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

export function ProductionExecutionQueueTable({
  items,
  loading,
  error,
  sortField,
  sortDirection,
  onSort,
  onRetry,
  onOpen,
}: ProductionExecutionQueueTableProps) {
  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center">
        <p className="text-base font-medium text-red-800">
          Failed to load production queue
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
      <div className="border-b border-zinc-200 bg-zinc-50 px-4 py-4">
        <h2 className="text-base font-semibold text-zinc-900">
          Production Queue
        </h2>
        <p className="mt-0.5 text-sm text-zinc-500">
          Plans with status Ready for Production.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full">
          <thead className="bg-zinc-50">
            <tr>
              <SortableHeader
                label="Plan Name"
                field="name"
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
              <SortableHeader
                label="Products"
                field="product_count"
                sortField={sortField}
                sortDirection={sortDirection}
                align="right"
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
                label="Last Calculated"
                field="last_calculated_at"
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
              <QueueTableSkeleton />
            ) : items.length === 0 ? (
              <QueueEmptyState />
            ) : (
              items.map((item) => (
                <ProductionExecutionQueueRow
                  key={item.id}
                  item={item}
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
