"use client";

import { formatDateTime } from "@/lib/date";
import { formatMoney } from "@/lib/money";
import type { PosQueueOrder } from "../hooks/use-pos-queue";

type PosQueuePaneProps = {
  items: PosQueueOrder[];
  loading: boolean;
  error: string | null;
  actionError: string | null;
  fulfillingId: string | null;
  onRetry: () => void;
  onMarkFulfilled: (saleId: string) => void;
};

function formatQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}

export function PosQueuePane({
  items,
  loading,
  error,
  actionError,
  fulfillingId,
  onRetry,
  onMarkFulfilled,
}: PosQueuePaneProps) {
  if (loading) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-8 text-center text-zinc-600 shadow-sm">
        Loading queue…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center shadow-sm">
        <p className="text-base font-medium text-red-800">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 min-h-12 rounded-lg bg-red-600 px-4 py-2 text-base font-semibold text-white hover:bg-red-700"
        >
          Try again
        </button>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-8 text-center shadow-sm">
        <p className="text-base font-medium text-zinc-900">
          No orders in queue
        </p>
        <p className="mt-1 text-sm text-zinc-500">
          Confirmed sales marked for the kitchen appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {actionError ? (
        <p className="text-sm text-red-600" role="alert">
          {actionError}
        </p>
      ) : null}

      <ul className="flex flex-col gap-4">
        {items.map((order) => {
          const isFulfilling = fulfillingId === order.sale_id;

          return (
            <li
              key={order.sale_id}
              className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-base font-semibold text-zinc-900">
                    {order.sale_number}
                  </p>
                  <p className="mt-0.5 text-sm text-zinc-500">
                    {formatDateTime(order.confirmed_at)}
                  </p>
                </div>
                <p className="shrink-0 text-lg font-semibold text-zinc-900">
                  {formatMoney(order.total)}
                </p>
              </div>

              <ul className="mt-3 space-y-1">
                {order.lines.map((line) => (
                  <li
                    key={`${order.sale_id}-${line.product_id}`}
                    className="flex justify-between gap-3 text-sm text-zinc-700"
                  >
                    <span className="min-w-0 truncate">{line.name}</span>
                    <span className="shrink-0 tabular-nums">
                      × {formatQuantity(line.quantity)}
                    </span>
                  </li>
                ))}
              </ul>

              <button
                type="button"
                disabled={isFulfilling}
                onClick={() => onMarkFulfilled(order.sale_id)}
                className="mt-4 min-h-12 w-full rounded-lg bg-amber-500 px-4 py-3 text-base font-semibold text-white transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isFulfilling ? "Saving..." : "Готово"}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
