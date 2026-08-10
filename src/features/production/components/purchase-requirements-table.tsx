import type { ProductionPlanIngredient } from "../types/production";

type PurchaseRequirementsTableProps = {
  ingredients: ProductionPlanIngredient[];
};

function formatQuantity(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }

  return value.toFixed(3).replace(/\.?0+$/, "");
}

export function PurchaseRequirementsTable({
  ingredients,
}: PurchaseRequirementsTableProps) {
  const hasMissing = ingredients.some((line) => line.missing_quantity > 0);

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200">
      <div className="border-b border-zinc-200 bg-zinc-50 px-4 py-3">
        <p className="text-sm font-semibold text-zinc-900">
          Purchase Requirements
        </p>
        <p className="mt-0.5 text-xs text-zinc-500">
          Snapshot from planning time. Values stay fixed if inventory changes
          later.
        </p>
      </div>

      {!hasMissing && (
        <div className="border-b border-green-200 bg-green-50 px-4 py-3">
          <p className="text-sm font-medium text-green-800">
            All required ingredients are available.
          </p>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="min-w-full">
          <thead className="bg-white">
            <tr>
              <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Ingredient
              </th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Required
              </th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-zinc-500">
                In Stock
              </th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Missing
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Unit
              </th>
            </tr>
          </thead>
          <tbody>
            {ingredients.map((line) => {
              const isMissing = line.missing_quantity > 0;

              return (
                <tr
                  key={line.id}
                  className={`border-t border-zinc-200 ${
                    isMissing ? "bg-red-50" : "bg-white"
                  }`}
                >
                  <td
                    className={`px-4 py-3 text-sm font-medium ${
                      isMissing ? "text-red-800" : "text-zinc-900"
                    }`}
                  >
                    {line.ingredient_name}
                  </td>
                  <td
                    className={`px-4 py-3 text-right text-sm ${
                      isMissing ? "text-red-700" : "text-zinc-700"
                    }`}
                  >
                    {formatQuantity(line.required_quantity)}
                  </td>
                  <td
                    className={`px-4 py-3 text-right text-sm ${
                      isMissing ? "text-red-700" : "text-zinc-700"
                    }`}
                  >
                    {formatQuantity(line.inventory_quantity_at_planning)}
                  </td>
                  <td
                    className={`px-4 py-3 text-right text-sm font-semibold ${
                      isMissing ? "text-red-700" : "text-green-700"
                    }`}
                  >
                    {formatQuantity(line.missing_quantity)}
                  </td>
                  <td
                    className={`px-4 py-3 text-sm ${
                      isMissing ? "text-red-700" : "text-zinc-600"
                    }`}
                  >
                    {line.unit}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
