import type { ProductionBatchWithProduct } from "../types/production-batch";
import type { ProductionAccountingPostingStatus } from "../types/production-session";
import { formatExecutionDateTime } from "../utils/format-execution-plan";

type ProductionSessionBatchesSectionProps = {
  batches: ProductionBatchWithProduct[];
  /** Session completion timestamp (DEV-106). Falls back to batch.produced_at. */
  completionDate?: string | null;
  /** Session-level accounting journal status (DEV-106). */
  accountingPostingStatus?: ProductionAccountingPostingStatus;
};

function formatMoney(value: number): string {
  return `€${value.toFixed(2)}`;
}

function formatUnitCost(value: number): string {
  return `€${value.toFixed(4)}`;
}

function formatQuantity(value: number, unit: string): string {
  const qty = Number.isInteger(value) ? String(value) : value.toFixed(3);
  return unit ? `${qty} ${unit}` : qty;
}

function formatPostingStatus(
  status: ProductionAccountingPostingStatus | undefined,
): string {
  return status === "posted" ? "✓ Posted" : "Pending";
}

export function ProductionSessionBatchesSection({
  batches,
  completionDate,
  accountingPostingStatus = "pending",
}: ProductionSessionBatchesSectionProps) {
  if (batches.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white px-4 py-6 text-sm text-zinc-600 shadow-sm">
        No production batches were created (all actual quantities were zero).
      </div>
    );
  }

  const postingLabel = formatPostingStatus(accountingPostingStatus);

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
        <div className="border-b border-zinc-200 px-4 py-4">
          <h2 className="text-base font-semibold text-zinc-900">
            Production Batches
          </h2>
          <p className="mt-0.5 text-sm text-zinc-500">
            Immutable finished-goods lots with frozen production valuation.
            Remaining quantity and value are calculated — never stored on the
            batch.
          </p>
          <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Production Completion Date
              </dt>
              <dd
                className="mt-0.5 text-zinc-800"
                data-testid="production-completion-date"
              >
                {formatExecutionDateTime(
                  completionDate ?? batches[0]?.produced_at,
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Accounting Posting Status
              </dt>
              <dd
                className="mt-0.5 text-zinc-800"
                data-testid="accounting-posting-status"
              >
                {postingLabel}
              </dd>
            </div>
          </dl>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-zinc-200 text-sm">
            <thead className="bg-zinc-50 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-3">Batch</th>
                <th className="px-4 py-3">Finished Good</th>
                <th className="px-4 py-3">Produced Quantity</th>
                <th className="px-4 py-3">Remaining Quantity</th>
                <th className="px-4 py-3">Unit Cost</th>
                <th className="px-4 py-3">Total Batch Cost</th>
                <th className="px-4 py-3">Remaining Inventory Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {batches.map((batch) => (
                <tr key={batch.id}>
                  <td className="px-4 py-3 font-medium text-zinc-900">
                    #{batch.batch_number}
                  </td>
                  <td className="px-4 py-3 text-zinc-800">
                    {batch.product_name}
                  </td>
                  <td className="px-4 py-3 text-zinc-800">
                    {formatQuantity(batch.produced_quantity, batch.yield_unit)}
                  </td>
                  <td className="px-4 py-3 text-zinc-800">
                    {batch.remaining_quantity === null
                      ? "—"
                      : formatQuantity(
                          batch.remaining_quantity,
                          batch.yield_unit,
                        )}
                  </td>
                  <td className="px-4 py-3 text-zinc-800">
                    {batch.has_valuation
                      ? formatUnitCost(batch.unit_cost)
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-zinc-800">
                    {batch.has_valuation
                      ? formatMoney(batch.total_cost)
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-zinc-800">
                    {!batch.has_valuation || batch.remaining_value === null
                      ? "—"
                      : formatMoney(batch.remaining_value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {batches.map((batch) => {
        const batchCompletion = formatExecutionDateTime(
          completionDate ?? batch.produced_at,
        );

        return (
          <div
            key={`${batch.id}-cost`}
            className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm"
            data-testid={`batch-cost-details-${batch.id}`}
          >
            <div className="border-b border-zinc-200 px-4 py-3">
              <h3 className="text-sm font-semibold text-zinc-900">
                Batch #{batch.batch_number} — Valuation Details
              </h3>
              <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    Produced Quantity
                  </dt>
                  <dd className="mt-0.5 text-zinc-800">
                    {formatQuantity(batch.produced_quantity, batch.yield_unit)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    Remaining Quantity
                  </dt>
                  <dd className="mt-0.5 text-zinc-800">
                    {batch.remaining_quantity === null
                      ? "—"
                      : formatQuantity(
                          batch.remaining_quantity,
                          batch.yield_unit,
                        )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    Total Batch Cost
                  </dt>
                  <dd className="mt-0.5 text-zinc-800">
                    {batch.has_valuation
                      ? formatMoney(batch.total_cost)
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    Unit Cost
                  </dt>
                  <dd className="mt-0.5 text-zinc-800">
                    {batch.has_valuation
                      ? formatUnitCost(batch.unit_cost)
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    Remaining Inventory Value
                  </dt>
                  <dd className="mt-0.5 text-zinc-800">
                    {!batch.has_valuation || batch.remaining_value === null
                      ? "—"
                      : formatMoney(batch.remaining_value)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    Production Completion Date
                  </dt>
                  <dd className="mt-0.5 text-zinc-800">{batchCompletion}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    Accounting Posting Status
                  </dt>
                  <dd className="mt-0.5 text-zinc-800">{postingLabel}</dd>
                </div>
              </dl>
              {!batch.has_valuation ? (
                <p
                  className="mt-3 text-sm text-amber-700"
                  data-testid={`missing-valuation-${batch.id}`}
                >
                  Valuation unavailable for this batch. Costs are not displayed.
                </p>
              ) : null}
            </div>

            {batch.cost_breakdown.length === 0 ? (
              <p className="px-4 py-4 text-sm text-zinc-500">
                Ingredient cost breakdown is not available for this batch.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-zinc-200 text-sm">
                  <thead className="bg-zinc-50 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    <tr>
                      <th className="px-4 py-3">Ingredient</th>
                      <th className="px-4 py-3">Consumed</th>
                      <th className="px-4 py-3">Inventory Unit Cost</th>
                      <th className="px-4 py-3">Line Cost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {batch.cost_breakdown.map((line) => (
                      <tr key={`${batch.id}-${line.ingredient_id}`}>
                        <td className="px-4 py-3 font-medium text-zinc-900">
                          {line.ingredient_name}
                        </td>
                        <td className="px-4 py-3 text-zinc-800">
                          {formatQuantity(line.consumed_quantity, line.unit)}
                        </td>
                        <td className="px-4 py-3 text-zinc-800">
                          {formatUnitCost(line.inventory_unit_cost)}
                        </td>
                        <td className="px-4 py-3 text-zinc-800">
                          {formatMoney(line.line_cost)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
