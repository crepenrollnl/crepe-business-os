"use client";

import { useState } from "react";
import type { PurchaseAccountingPreviewData } from "../types/purchase-accounting-preview";

type PurchaseAccountingPreviewProps = {
  preview: PurchaseAccountingPreviewData;
  /** Override for tests — production defaults to collapsed. */
  defaultOpen?: boolean;
};

function formatMoney(value: number, currency: string): string {
  return `${currency} ${value.toFixed(2)}`;
}

function statusLabel(status: PurchaseAccountingPreviewData["status"]): string {
  if (status === "draft_proposal") {
    return "Draft Proposal";
  }
  return status;
}

export function PurchaseAccountingPreview({
  preview,
  defaultOpen = false,
}: PurchaseAccountingPreviewProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section
      className="overflow-hidden rounded-xl border border-zinc-200 bg-white"
      data-testid="purchase-accounting-preview"
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls="purchase-accounting-preview-panel"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-zinc-50"
      >
        <div>
          <h3 className="text-sm font-semibold text-zinc-900">
            Accounting Preview
          </h3>
          <p className="mt-0.5 text-xs text-zinc-500">
            {statusLabel(preview.status)} · no ledger persistence
          </p>
        </div>
        <span
          aria-hidden
          className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-600 transition-transform ${
            open ? "rotate-180" : ""
          }`}
        >
          <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden>
            <path
              d="M5 7.5L10 12.5L15 7.5"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>

      {open ? (
        <div
          id="purchase-accounting-preview-panel"
          className="space-y-4 border-t border-zinc-200 px-4 py-4"
          data-testid="purchase-accounting-preview-panel"
        >
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                Net Amount
              </dt>
              <dd className="mt-1 text-sm font-semibold text-zinc-900">
                {formatMoney(preview.net_amount, preview.currency)}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                Tax Total
              </dt>
              <dd className="mt-1 text-sm font-semibold text-zinc-900">
                {formatMoney(preview.tax_total, preview.currency)}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                Grand Total
              </dt>
              <dd className="mt-1 text-sm font-semibold text-zinc-900">
                {formatMoney(preview.grand_total, preview.currency)}
              </dd>
            </div>
          </dl>

          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h4 className="text-sm font-medium text-zinc-800">
                Journal Proposal
              </h4>
              <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-800">
                {statusLabel(preview.status)}
              </span>
            </div>

            {!preview.has_proposal || preview.lines.length === 0 ? (
              <p
                className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50 px-3 py-3 text-sm text-zinc-500"
                data-testid="purchase-accounting-preview-empty"
              >
                No journal proposal available for this purchase.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-zinc-200">
                <table className="min-w-full divide-y divide-zinc-200 text-sm">
                  <thead className="bg-zinc-50">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-zinc-600">
                        Account Role
                      </th>
                      <th className="px-3 py-2 text-right font-medium text-zinc-600">
                        Debit
                      </th>
                      <th className="px-3 py-2 text-right font-medium text-zinc-600">
                        Credit
                      </th>
                      <th className="px-3 py-2 text-right font-medium text-zinc-600">
                        Currency
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 bg-white">
                    {preview.lines.map((line, index) => (
                      <tr key={`${line.account_role}-${index}`}>
                        <td className="px-3 py-2 font-medium text-zinc-900">
                          {line.account_role}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-zinc-700">
                          {line.debit > 0 ? line.debit.toFixed(2) : "—"}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-zinc-700">
                          {line.credit > 0 ? line.credit.toFixed(2) : "—"}
                        </td>
                        <td className="px-3 py-2 text-right text-zinc-700">
                          {line.currency}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
