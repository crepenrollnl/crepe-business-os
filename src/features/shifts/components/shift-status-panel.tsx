"use client";

import { useState } from "react";
import { formatDateTime } from "@/lib/date";
import { formatMoney } from "@/lib/money";
import type { CashReconciliation } from "../types/cash-reconciliation";
import type { Shift } from "../types/shift";
import { getCashReconciliationStatus } from "../utils/cash-reconciliation";

type ShiftStatusPanelProps = {
  activeShift: Shift | null;
  closedShift?: Shift | null;
  reconciliation?: CashReconciliation | null;
  loading?: boolean;
  mutating?: boolean;
  error?: string | null;
  actionError?: string | null;
  onOpenShift: () => void;
  onCloseShift: () => void;
  onReconcileCash?: (countedCash: number) => void;
  onRetry?: () => void;
};

function formatCashStatus(difference: number): string {
  return getCashReconciliationStatus(difference) === "balanced"
    ? "Balanced"
    : "Difference";
}

function ReviewField({
  label,
  value,
  testId,
}: {
  label: string;
  value: string;
  testId: string;
}) {
  return (
    <div>
      <dt className="font-medium text-zinc-500">{label}</dt>
      <dd
        className="mt-1 text-lg font-semibold text-zinc-900"
        data-testid={testId}
      >
        {value}
      </dd>
    </div>
  );
}

export function ShiftStatusPanel({
  activeShift,
  closedShift = null,
  reconciliation = null,
  loading = false,
  mutating = false,
  error = null,
  actionError = null,
  onOpenShift,
  onCloseShift,
  onReconcileCash,
  onRetry,
}: ShiftStatusPanelProps) {
  const [countedCashInput, setCountedCashInput] = useState("");
  const isOpen = Boolean(activeShift);
  const reviewedShift = activeShift ?? closedShift;
  const statusLabel = isOpen
    ? "OPEN"
    : reviewedShift
      ? "CLOSED"
      : "NEVER OPENED";
  const showClosedReview = !isOpen && Boolean(closedShift);
  const cashStatus = reconciliation
    ? formatCashStatus(reconciliation.difference)
    : null;

  return (
    <div
      className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm"
      data-testid="shift-status-panel"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
            Shift Details
          </h3>
          {loading ? (
            <p className="mt-3 text-sm text-zinc-500">Loading shift…</p>
          ) : error ? (
            <div className="mt-3 space-y-2">
              <p className="text-sm text-red-700">{error}</p>
              {onRetry ? (
                <button
                  type="button"
                  onClick={onRetry}
                  className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-50"
                >
                  Retry
                </button>
              ) : null}
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              <p
                className="text-2xl font-semibold text-zinc-900"
                data-testid="shift-status-label"
              >
                {statusLabel}
              </p>
              {reviewedShift ? (
                <dl className="space-y-1 text-sm text-zinc-600">
                  <div>
                    <dt className="inline font-medium text-zinc-500">
                      Opened At
                    </dt>{" "}
                    <dd className="inline" data-testid="shift-opened-at">
                      {formatDateTime(reviewedShift.opened_at)}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline font-medium text-zinc-500">
                      Closed At
                    </dt>{" "}
                    <dd className="inline" data-testid="shift-closed-at">
                      {formatDateTime(reviewedShift.closed_at)}
                    </dd>
                  </div>
                  {reviewedShift.notes ? (
                    <div>
                      <dt className="inline font-medium text-zinc-500">Notes</dt>{" "}
                      <dd className="inline">{reviewedShift.notes}</dd>
                    </div>
                  ) : null}
                </dl>
              ) : (
                <p className="text-sm text-zinc-500">
                  No shift is open. Open a shift to start the business day.
                </p>
              )}
              {isOpen ? (
                <p
                  className="text-sm text-zinc-500"
                  data-testid="active-shift-review-note"
                >
                  Close the shift to freeze and review the daily operational
                  summary.
                </p>
              ) : null}
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={onOpenShift}
            disabled={loading || mutating || isOpen || Boolean(error)}
            data-testid="open-shift-button"
            className="inline-flex min-h-12 items-center justify-center rounded-lg bg-amber-500 px-5 py-3 text-base font-semibold text-white transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {mutating && !isOpen ? "Opening…" : "Open Shift"}
          </button>
          <button
            type="button"
            onClick={onCloseShift}
            disabled={loading || mutating || !isOpen || Boolean(error)}
            data-testid="close-shift-button"
            className="inline-flex min-h-12 items-center justify-center rounded-lg border border-zinc-300 bg-white px-5 py-3 text-base font-semibold text-zinc-700 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {mutating && isOpen ? "Closing…" : "Close Shift"}
          </button>
        </div>
      </div>

      {showClosedReview && !loading && !error ? (
        <div
          className="mt-6 border-t border-zinc-100 pt-6"
          data-testid="shift-close-day-review"
        >
          <h4 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
            Close Day Review
          </h4>
          <p className="mt-1 text-sm text-zinc-500">
            Immutable stored values only. Missing summaries are shown as
            informational states and are never recalculated here.
          </p>

          <div
            className="mt-6"
            data-testid="cash-reconciliation-section"
          >
            <h5 className="text-sm font-semibold text-zinc-800">
              Cash Reconciliation
            </h5>
            {reconciliation ? (
              <div className="mt-3 space-y-3">
                <dl className="grid gap-3 text-sm text-zinc-700 sm:grid-cols-2 lg:grid-cols-4">
                  <ReviewField
                    label="Expected Cash"
                    value={formatMoney(reconciliation.expected_cash)}
                    testId="expected-cash"
                  />
                  <ReviewField
                    label="Counted Cash"
                    value={formatMoney(reconciliation.counted_cash)}
                    testId="counted-cash"
                  />
                  <ReviewField
                    label="Cash Difference"
                    value={formatMoney(reconciliation.difference)}
                    testId="cash-difference"
                  />
                  <div>
                    <dt className="font-medium text-zinc-500">Cash Status</dt>
                    <dd
                      className={
                        cashStatus === "Balanced"
                          ? "mt-1 text-lg font-semibold text-emerald-700"
                          : "mt-1 text-lg font-semibold text-amber-700"
                      }
                      data-testid="cash-reconciliation-status"
                    >
                      {cashStatus === "Balanced"
                        ? "✓ Balanced"
                        : "⚠ Difference"}
                    </dd>
                  </div>
                </dl>
              </div>
            ) : (
              <div className="mt-3 space-y-4">
                <p
                  className="text-sm text-zinc-500"
                  data-testid="missing-cash-reconciliation"
                >
                  Cash reconciliation has not been recorded for this shift.
                </p>

                <div className="flex flex-wrap items-end gap-3">
                  <label className="block text-sm text-zinc-700">
                    <span className="font-medium text-zinc-500">
                      Counted Cash
                    </span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      value={countedCashInput}
                      onChange={(event) => {
                        setCountedCashInput(event.target.value);
                      }}
                      disabled={mutating}
                      data-testid="counted-cash-input"
                      className="mt-1 block w-full max-w-[12rem] rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-200 disabled:opacity-50"
                      placeholder="0.00"
                    />
                  </label>
                  <button
                    type="button"
                    disabled={mutating || !onReconcileCash}
                    data-testid="reconcile-cash-button"
                    onClick={() => {
                      if (!onReconcileCash) {
                        return;
                      }
                      const parsed = Number(countedCashInput);
                      onReconcileCash(parsed);
                    }}
                    className="inline-flex items-center justify-center rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {mutating ? "Saving…" : "Reconcile Cash"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {actionError ? (
        <p className="mt-4 text-sm text-red-600" data-testid="shift-action-error">
          {actionError}
        </p>
      ) : null}
    </div>
  );
}
