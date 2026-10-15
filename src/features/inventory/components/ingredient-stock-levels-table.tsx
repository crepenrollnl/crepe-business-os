import type {
  IngredientStockLevel,
  IngredientStockSortField,
  InventorySortDirection,
} from "../types/inventory";

/** Name, Category, Unit, Current Quantity, Minimum Stock. */
const COLUMN_COUNT = 5;

type IngredientStockLevelsTableProps = {
  items: IngredientStockLevel[];
  totalCount: number;
  hasActiveFilters: boolean;
  loading: boolean;
  error: string | null;
  sortField: IngredientStockSortField;
  sortDirection: InventorySortDirection;
  onSort: (field: IngredientStockSortField) => void;
  onRetry: () => void;
};

type StockStatus = "ok" | "low" | "out";

function getStockStatus(item: IngredientStockLevel): StockStatus {
  if (item.current_stock === 0) {
    return "out";
  }
  if (item.current_stock <= item.minimum_stock) {
    return "low";
  }
  return "ok";
}

function getRowClassName(status: StockStatus): string {
  if (status === "out") {
    return "border-red-200 bg-red-100/80 hover:bg-red-100";
  }
  if (status === "low") {
    return "border-amber-100 bg-amber-50/80 hover:bg-amber-50";
  }
  return "border-zinc-200 hover:bg-zinc-50";
}

function getStockBadgeClass(status: StockStatus): string {
  if (status === "out") {
    return "bg-red-200 text-red-800";
  }
  if (status === "low") {
    return "bg-amber-100 text-amber-800";
  }
  return "bg-green-100 text-green-700";
}

function formatQuantity(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }
  return value.toFixed(3).replace(/\.?0+$/, "");
}

type SortableHeaderProps = {
  label: string;
  field: IngredientStockSortField;
  sortField: IngredientStockSortField;
  sortDirection: InventorySortDirection;
  align?: "left" | "right";
  onSort: (field: IngredientStockSortField) => void;
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

/**
 * Seller Inventory (S4/U5): quantities only — no prices, suppliers,
 * purchasing columns or actions. Data from ingredient_stock_levels (sql/155).
 */
export function IngredientStockLevelsTable({
  items,
  totalCount,
  hasActiveFilters,
  loading,
  error,
  sortField,
  sortDirection,
  onSort,
  onRetry,
}: IngredientStockLevelsTableProps) {
  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center">
        <p className="text-base font-medium text-red-800">
          Failed to load inventory
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
              <th className="px-4 py-3 text-left text-sm font-semibold text-zinc-700">
                Category
              </th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-zinc-700">
                Unit
              </th>
              <SortableHeader
                label="Current Quantity"
                field="current_stock"
                sortField={sortField}
                sortDirection={sortDirection}
                align="right"
                onSort={onSort}
              />
              <SortableHeader
                label="Minimum Stock"
                field="minimum_stock"
                sortField={sortField}
                sortDirection={sortDirection}
                align="right"
                onSort={onSort}
              />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, index) => (
                <tr key={index} className="border-t border-zinc-200">
                  {Array.from({ length: COLUMN_COUNT }).map((__, cellIndex) => (
                    <td key={cellIndex} className="px-4 py-4">
                      <div className="h-4 animate-pulse rounded bg-zinc-200" />
                    </td>
                  ))}
                </tr>
              ))
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={COLUMN_COUNT} className="px-4 py-16 text-center">
                  <p className="text-base font-medium text-zinc-900">
                    {hasActiveFilters && totalCount > 0
                      ? "No matching ingredients"
                      : "No ingredients yet"}
                  </p>
                  {hasActiveFilters && totalCount > 0 ? (
                    <p className="mt-2 text-sm text-zinc-500">
                      Try adjusting your search or category filter to find what
                      you need.
                    </p>
                  ) : null}
                </td>
              </tr>
            ) : (
              items.map((item) => {
                const status = getStockStatus(item);
                return (
                  <tr
                    key={item.id}
                    className={`border-t transition-colors ${getRowClassName(status)}`}
                  >
                    <td className="px-4 py-4 font-medium text-zinc-900">
                      {item.name}
                    </td>
                    <td className="px-4 py-4 text-zinc-600">
                      {item.category?.name ?? "—"}
                    </td>
                    <td className="px-4 py-4 text-zinc-600">{item.unit}</td>
                    <td className="px-4 py-4 text-right">
                      <span
                        className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${getStockBadgeClass(
                          status,
                        )}`}
                        data-testid="current-quantity"
                      >
                        {formatQuantity(item.current_stock)}
                      </span>
                    </td>
                    <td
                      className="px-4 py-4 text-right text-zinc-600"
                      data-testid="minimum-stock"
                    >
                      {formatQuantity(item.minimum_stock)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
