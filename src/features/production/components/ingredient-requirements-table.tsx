import type { ProductionRequirementPreview } from "../types/production";

type IngredientRequirementsTableProps = {
  preview: ProductionRequirementPreview | null;
  isLoading: boolean;
  error: string | null;
};

function formatQuantity(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }

  return value.toFixed(3).replace(/\.?0+$/, "");
}

export function IngredientRequirementsTable({
  preview,
  isLoading,
  error,
}: IngredientRequirementsTableProps) {
  if (isLoading) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-zinc-50/70 p-4">
        <p className="text-sm font-medium text-zinc-900">
          Calculating combined ingredient requirements...
        </p>
        <div className="mt-3 space-y-2">
          {Array.from({ length: 3 }).map((_, index) => (
            <div
              key={index}
              className="h-10 animate-pulse rounded-lg bg-zinc-100"
            />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4">
        <p className="text-sm font-medium text-red-800">
          Could not calculate requirements
        </p>
        <p className="mt-1 text-sm text-red-600">{error}</p>
      </div>
    );
  }

  if (!preview || preview.lines.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50/50 p-4">
        <p className="text-sm text-zinc-500">
          Add products and quantities to preview combined ingredient
          requirements versus current inventory.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200">
      <div className="flex items-center justify-between gap-3 border-b border-zinc-200 bg-zinc-50 px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-zinc-900">
            Ingredient calculation preview
          </p>
          <p className="mt-0.5 text-xs text-zinc-500">
            Live preview before saving. Snapshot is stored when the plan is
            created.
          </p>
        </div>
        {preview.missing_line_count > 0 && (
          <span className="inline-flex items-center rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-700">
            {preview.missing_line_count} short
          </span>
        )}
      </div>

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
            {preview.lines.map((line) => {
              const isShort = !line.is_sufficient;

              return (
                <tr
                  key={line.ingredient_id}
                  className={`border-t border-zinc-200 ${
                    isShort ? "bg-red-50" : "bg-white"
                  }`}
                >
                  <td
                    className={`px-4 py-3 text-sm font-medium ${
                      isShort ? "text-red-800" : "text-zinc-900"
                    }`}
                  >
                    {line.ingredient_name}
                  </td>
                  <td
                    className={`px-4 py-3 text-right text-sm ${
                      isShort ? "text-red-700" : "text-zinc-700"
                    }`}
                  >
                    {formatQuantity(line.required_quantity)}
                  </td>
                  <td
                    className={`px-4 py-3 text-right text-sm ${
                      isShort ? "text-red-700" : "text-zinc-700"
                    }`}
                  >
                    {formatQuantity(line.current_stock)}
                  </td>
                  <td
                    className={`px-4 py-3 text-right text-sm font-semibold ${
                      isShort ? "text-red-700" : "text-green-700"
                    }`}
                  >
                    {formatQuantity(line.missing_quantity)}
                  </td>
                  <td
                    className={`px-4 py-3 text-sm ${
                      isShort ? "text-red-700" : "text-zinc-600"
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
