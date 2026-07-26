import type { ProductionBatchWithProduct } from "../types/production-batch";

type ProductionSessionBatchesSectionProps = {
  batches: ProductionBatchWithProduct[];
};

function formatMoney(value: number): string {
  return `€${value.toFixed(2)}`;
}

function formatQuantity(value: number, unit: string): string {
  const qty = Number.isInteger(value) ? String(value) : value.toFixed(3);
  return unit ? `${qty} ${unit}` : qty;
}

export function ProductionSessionBatchesSection({
  batches,
}: ProductionSessionBatchesSectionProps) {
  if (batches.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white px-4 py-6 text-sm text-zinc-600 shadow-sm">
        No production batches were created (all actual quantities were zero).
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="border-b border-zinc-200 px-4 py-4">
        <h2 className="text-base font-semibold text-zinc-900">
          Production Batches
        </h2>
        <p className="mt-0.5 text-sm text-zinc-500">
          Immutable finished-goods batches created on completion. Available for
          sales immediately.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-zinc-200 text-sm">
          <thead className="bg-zinc-50 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-4 py-3">Batch</th>
              <th className="px-4 py-3">Finished Good</th>
              <th className="px-4 py-3">Produced</th>
              <th className="px-4 py-3">Unit Cost</th>
              <th className="px-4 py-3">Total Cost</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {batches.map((batch) => {
              const totalCost = batch.produced_quantity * batch.unit_cost;
              return (
                <tr key={batch.id}>
                  <td className="px-4 py-3 font-medium text-zinc-900">
                    #{batch.batch_number}
                  </td>
                  <td className="px-4 py-3 text-zinc-800">{batch.product_name}</td>
                  <td className="px-4 py-3 text-zinc-800">
                    {formatQuantity(batch.produced_quantity, batch.yield_unit)}
                  </td>
                  <td className="px-4 py-3 text-zinc-800">
                    {formatMoney(batch.unit_cost)}
                  </td>
                  <td className="px-4 py-3 text-zinc-800">
                    {formatMoney(totalCost)}
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
