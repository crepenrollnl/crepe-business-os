import type { IngredientWithRelations } from "../types/inventory";

type InventoryRowProps = {
  item: IngredientWithRelations;
  onEdit: (item: IngredientWithRelations) => void;
  onDelete: (item: IngredientWithRelations) => void;
};

type StockStatus = "ok" | "low" | "out";

function WarningIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="currentColor"
      className="h-3.5 w-3.5"
    >
      <path
        fillRule="evenodd"
        d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 10-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function getStockStatus(item: IngredientWithRelations): StockStatus {
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

export function InventoryRow({ item, onEdit, onDelete }: InventoryRowProps) {
  const stockStatus = getStockStatus(item);
  const showWarning = stockStatus !== "ok";

  return (
    <tr className={`border-t transition-colors ${getRowClassName(stockStatus)}`}>
      <td className="px-4 py-4 font-medium text-zinc-900">{item.name}</td>
      <td className="px-4 py-4 text-zinc-600">{item.category?.name ?? "—"}</td>
      <td className="px-4 py-4 text-zinc-600">{item.supplier?.name ?? "—"}</td>
      <td className="px-4 py-4 text-zinc-600">{item.unit}</td>
      <td className="px-4 py-4 text-right">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ${getStockBadgeClass(
            stockStatus,
          )}`}
        >
          {showWarning && <WarningIcon />}
          {item.current_stock}
        </span>
      </td>
      <td className="px-4 py-4 text-right text-zinc-600">{item.minimum_stock}</td>
      <td className="px-4 py-4 text-right font-medium text-zinc-900">
        €{item.cost_per_unit.toFixed(2)}
      </td>
      <td className="px-4 py-4 text-right">
        <div className="inline-flex items-center gap-2">
          <button
            type="button"
            onClick={() => onEdit(item)}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => onDelete(item)}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 hover:text-red-700"
          >
            Delete
          </button>
        </div>
      </td>
    </tr>
  );
}
