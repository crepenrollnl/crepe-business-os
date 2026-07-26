import type {
  ProductionPlanShoppingItem,
  ShoppingListStatus,
} from "../types/production";

type ShoppingListPanelProps = {
  status: ShoppingListStatus;
  items: ProductionPlanShoppingItem[];
  isGenerating: boolean;
  disabled: boolean;
  onGenerate: () => void;
};

function formatQuantity(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }

  return value.toFixed(3).replace(/\.?0+$/, "");
}

export function ShoppingListPanel({
  status,
  items,
  isGenerating,
  disabled,
  onGenerate,
}: ShoppingListPanelProps) {
  return (
    <div className="rounded-xl border border-zinc-200">
      <div className="flex flex-col gap-3 border-b border-zinc-200 bg-zinc-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-zinc-900">Shopping List</p>
          <p className="mt-0.5 text-xs text-zinc-500">
            Recommendation only. Contains missing ingredients. Does not change
            inventory.
          </p>
        </div>
        <button
          type="button"
          onClick={onGenerate}
          disabled={disabled || isGenerating}
          className="inline-flex items-center justify-center rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isGenerating
            ? "Generating..."
            : status === "generated"
              ? "Regenerate Shopping List"
              : "Generate Shopping List"}
        </button>
      </div>

      {status === "not_generated" ? (
        <div className="px-4 py-4">
          <p className="text-sm text-zinc-500">
            Shopping list has not been generated yet.
          </p>
        </div>
      ) : items.length === 0 ? (
        <div className="px-4 py-4">
          <p className="text-sm font-medium text-green-800">
            All required ingredients are available. Shopping list is empty.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-zinc-200">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
            >
              <span className="font-medium text-zinc-900">
                {item.ingredient_name}
              </span>
              <span className="text-zinc-700">
                {formatQuantity(item.quantity)} {item.unit}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
