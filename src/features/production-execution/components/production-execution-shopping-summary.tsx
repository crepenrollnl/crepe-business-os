import type { ProductionPlanShoppingItem } from "../types/production-execution";
import { formatQuantity } from "../utils/format-execution-plan";

type ProductionExecutionShoppingSummaryProps = {
  items: ProductionPlanShoppingItem[];
  shoppingListStatus: "not_generated" | "generated";
};

export function ProductionExecutionShoppingSummary({
  items,
  shoppingListStatus,
}: ProductionExecutionShoppingSummaryProps) {
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="border-b border-zinc-200 bg-zinc-50 px-4 py-4">
        <h2 className="text-base font-semibold text-zinc-900">
          Shopping Summary
        </h2>
        <p className="mt-0.5 text-sm text-zinc-500">
          Shortage recommendation from planning. Read-only.
        </p>
      </div>

      {shoppingListStatus === "not_generated" ? (
        <div className="px-4 py-12 text-center">
          <p className="text-sm font-medium text-zinc-900">
            Shopping list not generated
          </p>
          <p className="mt-1 text-sm text-zinc-500">
            Generate a shopping list in Production Planning if ingredients are
            missing.
          </p>
        </div>
      ) : items.length === 0 ? (
        <div className="px-4 py-12 text-center">
          <p className="text-sm font-medium text-green-800">
            All required ingredients are available
          </p>
          <p className="mt-1 text-sm text-zinc-500">
            Shopping list is empty — nothing additional to purchase.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead className="bg-zinc-50">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-semibold text-zinc-700">
                  Ingredient
                </th>
                <th className="px-4 py-3 text-right text-sm font-semibold text-zinc-700">
                  Quantity
                </th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-zinc-700">
                  Unit
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.id}
                  className="border-t border-zinc-200 bg-white"
                >
                  <td className="px-4 py-4 text-sm font-medium text-zinc-900">
                    {item.ingredient_name}
                  </td>
                  <td className="px-4 py-4 text-right text-sm text-zinc-700">
                    {formatQuantity(item.quantity)}
                  </td>
                  <td className="px-4 py-4 text-sm text-zinc-600">{item.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
