"use client";

import { useSaleableNow } from "../hooks/use-saleable-now";

export function PosSaleableNowSection() {
  const { rows, loading, error, retry } = useSaleableNow();

  return (
    <section aria-labelledby="pos-saleable-now-heading" className="space-y-3">
      <div>
        <h2
          id="pos-saleable-now-heading"
          className="text-base font-semibold text-zinc-900"
        >
          Can sell now
        </h2>
        <p className="mt-1 text-sm text-zinc-500">
          Portions confirm_sale can ship from finished components and raw
          add-ins already on hand.
        </p>
      </div>

      {loading ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-8 text-center text-zinc-600 shadow-sm">
          Loading saleable quantities…
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center shadow-sm">
          <p className="text-base font-medium text-red-800">{error}</p>
          <button
            type="button"
            onClick={() => {
              void retry();
            }}
            className="mt-4 min-h-12 rounded-lg bg-red-600 px-4 py-2 text-base font-semibold text-white hover:bg-red-700"
          >
            Try again
          </button>
        </div>
      ) : null}

      {!loading && !error && rows.length === 0 ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-8 text-center shadow-sm">
          <p className="text-base font-medium text-zinc-900">
            No priced assembly products
          </p>
          <p className="mt-1 text-sm text-zinc-500">
            Set a selling price on an active assembly recipe to see how many
            portions can be sold right now.
          </p>
        </div>
      ) : null}

      {!loading && !error && rows.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-zinc-50 text-zinc-600">
              <tr>
                <th className="px-4 py-3 font-semibold">Product</th>
                <th className="px-4 py-3 font-semibold">Portions</th>
                <th className="px-4 py-3 font-semibold">Limited by</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200">
              {rows.map((row) => (
                <tr key={row.product_id}>
                  <td className="px-4 py-3 font-medium text-zinc-900">
                    {row.product_name}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-zinc-900">
                    {row.max_portions}
                  </td>
                  <td className="px-4 py-3 text-zinc-600">
                    {row.bottleneck_name ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-zinc-200 px-4 py-3 text-sm text-zinc-500">
            Figures are independent per product and must not be added together
            when dishes share ingredients or components.
          </p>
        </div>
      ) : null}
    </section>
  );
}
