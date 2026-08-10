"use client";

import Link from "next/link";
import type { SaleDetail } from "../types/sale";
import {
  formatSaleCustomer,
  formatSaleDate,
  formatSaleDateTime,
  formatSaleStatus,
  getSaleStatusBadgeClass,
} from "../utils/format-sale";

type SaleHeaderProps = {
  sale: SaleDetail;
  confirming: boolean;
  mutating: boolean;
  canConfirm: boolean;
  actionError: string | null;
  onConfirmClick: () => void;
};

export function SaleHeader({
  sale,
  confirming,
  mutating,
  canConfirm,
  actionError,
  onConfirmClick,
}: SaleHeaderProps) {
  const isDraft = sale.status === "draft";
  const actionsDisabled = confirming || mutating || !canConfirm;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl">
              Sale {sale.sale_number}
            </h1>
            <span
              className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${getSaleStatusBadgeClass(
                sale.status,
              )}`}
            >
              {formatSaleStatus(sale.status)}
            </span>
          </div>

          <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-zinc-600">
            <div>
              <dt className="inline font-medium text-zinc-500">Customer</dt>{" "}
              <dd className="inline text-zinc-800">
                {formatSaleCustomer(sale.customer_id)}
              </dd>
            </div>
            <div>
              <dt className="inline font-medium text-zinc-500">Sale Date</dt>{" "}
              <dd className="inline text-zinc-800">
                {formatSaleDate(sale.sale_date)}
              </dd>
            </div>
            <div>
              <dt className="inline font-medium text-zinc-500">Created</dt>{" "}
              <dd className="inline text-zinc-800">—</dd>
            </div>
            <div>
              <dt className="inline font-medium text-zinc-500">Confirmed</dt>{" "}
              <dd className="inline text-zinc-800">
                {formatSaleDateTime(sale.confirmed_at)}
              </dd>
            </div>
            <div>
              <dt className="inline font-medium text-zinc-500">Paid</dt>{" "}
              <dd className="inline text-zinc-800">
                {formatSaleDateTime(sale.paid_at)}
              </dd>
            </div>
          </dl>
        </div>

        <div className="flex shrink-0 flex-col items-stretch gap-3 sm:items-end">
          <div className="flex flex-wrap items-center justify-end gap-3">
            <Link
              href="/sales"
              className="inline-flex items-center justify-center rounded-lg border border-zinc-300 bg-white px-5 py-2.5 text-sm font-semibold text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50"
            >
              Back to Sales
            </Link>

            {isDraft ? (
              <button
                type="button"
                onClick={onConfirmClick}
                disabled={actionsDisabled}
                title={
                  canConfirm
                    ? undefined
                    : "Add at least one line before confirming this sale."
                }
                className="inline-flex items-center justify-center rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {confirming ? "Confirming..." : "Confirm Sale"}
              </button>
            ) : null}
          </div>

          {actionError ? (
            <p className="max-w-sm text-right text-sm text-red-600">
              {actionError}
            </p>
          ) : null}
        </div>
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          Notes
        </p>
        <p className="mt-2 text-sm text-zinc-700">No notes recorded.</p>
      </div>
    </div>
  );
}
