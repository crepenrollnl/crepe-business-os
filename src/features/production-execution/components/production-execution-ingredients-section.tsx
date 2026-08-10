import type { ProductionPlanIngredient } from "../types/production-execution";
import { formatQuantity } from "../utils/format-execution-plan";

type ProductionExecutionIngredientsSectionProps = {
  ingredients: ProductionPlanIngredient[];
};

export function ProductionExecutionIngredientsSection({
  ingredients,
}: ProductionExecutionIngredientsSectionProps) {
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="border-b border-zinc-200 bg-zinc-50 px-4 py-4">
        <h2 className="text-base font-semibold text-zinc-900">
          Ingredient Requirements
        </h2>
        <p className="mt-0.5 text-sm text-zinc-500">
          Snapshot from production planning. Read-only.
        </p>
      </div>

      {ingredients.length === 0 ? (
        <div className="px-4 py-12 text-center">
          <p className="text-sm font-medium text-zinc-900">
            No ingredient requirements
          </p>
          <p className="mt-1 text-sm text-zinc-500">
            Calculate requirements in Production Planning before executing.
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
                  Required
                </th>
                <th className="px-4 py-3 text-right text-sm font-semibold text-zinc-700">
                  At Planning
                </th>
                <th className="px-4 py-3 text-right text-sm font-semibold text-zinc-700">
                  Missing
                </th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-zinc-700">
                  Unit
                </th>
              </tr>
            </thead>
            <tbody>
              {ingredients.map((ingredient) => {
                const isShort = ingredient.missing_quantity > 0;

                return (
                  <tr
                    key={ingredient.id}
                    className={`border-t border-zinc-200 ${
                      isShort ? "bg-red-50" : "bg-white"
                    }`}
                  >
                    <td
                      className={`px-4 py-4 text-sm font-medium ${
                        isShort ? "text-red-800" : "text-zinc-900"
                      }`}
                    >
                      {ingredient.ingredient_name}
                    </td>
                    <td
                      className={`px-4 py-4 text-right text-sm ${
                        isShort ? "text-red-700" : "text-zinc-700"
                      }`}
                    >
                      {formatQuantity(ingredient.required_quantity)}
                    </td>
                    <td
                      className={`px-4 py-4 text-right text-sm ${
                        isShort ? "text-red-700" : "text-zinc-700"
                      }`}
                    >
                      {formatQuantity(ingredient.inventory_quantity_at_planning)}
                    </td>
                    <td
                      className={`px-4 py-4 text-right text-sm font-semibold ${
                        isShort ? "text-red-700" : "text-green-700"
                      }`}
                    >
                      {formatQuantity(ingredient.missing_quantity)}
                    </td>
                    <td
                      className={`px-4 py-4 text-sm ${
                        isShort ? "text-red-700" : "text-zinc-600"
                      }`}
                    >
                      {ingredient.unit}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
