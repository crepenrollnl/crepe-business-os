import { formatUnitCost } from "@/lib/money";
import type { SaleCostSummary } from "../types/sale-cogs";
import { formatSaleMoney } from "../utils/format-sale";

type SaleCogsSectionProps = {
  summary: SaleCostSummary | null;
  loading?: boolean;
  error?: string | null;
};

function formatQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}

export function SaleCogsSection({
  summary,
  loading = false,
  error = null,
}: SaleCogsSectionProps) {
  if (loading) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white px-4 py-6 text-sm text-zinc-500 shadow-sm">
        Loading cost of goods…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800 shadow-sm">
        {error}
      </div>
    );
  }

  if (!summary) {
    return null;
  }

  return (
    <div
      className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm"
      data-testid="sale-cogs-section"
    >
      <div className="border-b border-zinc-200 px-4 py-4">
        <h2 className="text-base font-semibold text-zinc-900">
          Cost of Goods Sold
        </h2>
        <p className="mt-0.5 text-sm text-zinc-500">
          Frozen from Finished Goods batches consumed at confirmation. Unit
          costs are never recalculated.
        </p>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Total COGS
            </dt>
            <dd
              className="mt-0.5 text-base font-semibold text-zinc-900"
              data-testid="sale-total-cogs"
            >
              {formatSaleMoney(summary.total_cogs)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Consumed Quantity
            </dt>
            <dd className="mt-0.5 text-zinc-800">
              {formatQuantity(summary.consumed_quantity)}
            </dd>
          </div>
        </dl>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-zinc-200 text-sm">
          <thead className="bg-zinc-50 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-4 py-3">Batch</th>
              <th className="px-4 py-3">Quantity</th>
              <th className="px-4 py-3">Unit Cost</th>
              <th className="px-4 py-3">Layer Cost</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {summary.layers.map((layer) => (
              <tr key={layer.consumption_id}>
                <td className="px-4 py-3 font-medium text-zinc-900">
                  {layer.source === "ingredient"
                    ? (layer.ingredient_name ?? "Ingredient")
                    : layer.batch_number !== null
                      ? `#${layer.batch_number}`
                      : (layer.production_batch_id?.slice(0, 8) ?? "—")}
                </td>
                <td className="px-4 py-3 text-zinc-800">
                  {formatQuantity(layer.quantity)}
                </td>
                <td className="px-4 py-3 text-zinc-800">
                  {formatUnitCost(layer.unit_cost)}
                </td>
                <td className="px-4 py-3 text-zinc-800">
                  {formatSaleMoney(layer.total_cost)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
