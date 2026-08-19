"use client";

import { formatDateTime } from "@/lib/date";
import { formatMoney } from "@/lib/money";
import { usePosShift } from "../hooks/use-pos-shift";
import { usePosShiftSales } from "../hooks/use-pos-shift-sales";

export function PosHistoryPane() {
  const {
    historyShift,
    loading: shiftLoading,
    error: shiftError,
    retry: retryShift,
  } = usePosShift();
  const {
    items,
    loading: salesLoading,
    error: salesError,
    retry: retrySales,
  } = usePosShiftSales(historyShift);

  const loading = shiftLoading || (Boolean(historyShift) && salesLoading);
  const error = shiftError ?? salesError;
  const retry = shiftError ? retryShift : retrySales;

  if (loading) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-8 text-center text-zinc-600 shadow-sm">
        Loading shift sales…
      </div>
    );
  }

  if (error) {
    return (
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
    );
  }

  if (!historyShift) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-8 text-center shadow-sm">
        <p className="text-base font-medium text-zinc-900">No shift yet</p>
        <p className="mt-1 text-sm text-zinc-500">
          Open a shift to start the business day. Sales from the current shift
          will appear here.
        </p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-8 text-center shadow-sm">
        <p className="text-base font-medium text-zinc-900">No sales yet</p>
        <p className="mt-1 text-sm text-zinc-500">
          Confirmed sales from this shift will appear here.
        </p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
      {items.map((sale) => (
        <li
          key={sale.sale_id}
          className="flex items-center justify-between gap-4 px-4 py-4"
        >
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-zinc-900">
              {sale.sale_number}
            </p>
            <p className="mt-0.5 text-sm text-zinc-500">
              {formatDateTime(sale.confirmed_at)}
            </p>
          </div>
          <p className="shrink-0 text-lg font-semibold text-zinc-900">
            {formatMoney(sale.total)}
          </p>
        </li>
      ))}
    </ul>
  );
}
