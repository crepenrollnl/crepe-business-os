"use client";

import Link from "next/link";
import { formatDate } from "@/lib/date";
import { formatMoney } from "@/lib/money";
import type { ProfitAndLossReport } from "../types/profit-and-loss";
import { hasReconciliationMismatch } from "../utils/profit-and-loss-period";

export const PROFIT_AND_LOSS_MISMATCH_BANNER =
  "Some operations in this period may not be reflected in postings — the figures below may be incomplete";

type ProfitAndLossReportViewProps = {
  report: ProfitAndLossReport | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
};

function MetricRow(props: {
  label: string;
  value: number;
  emphasis?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-4 ${
        props.emphasis ? "pt-2 text-base font-semibold text-zinc-900" : ""
      }`}
    >
      <span className={props.emphasis ? "text-zinc-900" : "text-zinc-500"}>
        {props.label}
      </span>
      <span
        className={`tabular-nums ${
          props.emphasis ? "text-zinc-900" : "font-medium text-zinc-900"
        }`}
      >
        {formatMoney(props.value)}
      </span>
    </div>
  );
}

function ProfitAndLossSkeleton() {
  return (
    <div
      className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm"
      role="status"
      aria-live="polite"
    >
      <div className="space-y-4">
        {Array.from({ length: 7 }).map((_, index) => (
          <div key={index} className="h-5 animate-pulse rounded bg-zinc-200" />
        ))}
      </div>
    </div>
  );
}

function ProfitAndLossBody({ report }: { report: ProfitAndLossReport }) {
  const showBanner = hasReconciliationMismatch(report);

  return (
    <div className="space-y-4">
      {showBanner ? (
        <div
          className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 shadow-sm"
          role="status"
        >
          <p>
            <span>{PROFIT_AND_LOSS_MISMATCH_BANNER}</span>{" "}
            <Link
              href="/reports/posting-failures"
              className="font-semibold underline underline-offset-2 hover:text-amber-800"
            >
              Posting Failures
            </Link>
          </p>
        </div>
      ) : null}

      <p className="text-sm text-zinc-600">
        Period {formatDate(report.period_start)} –{" "}
        {formatDate(report.period_end)}.
      </p>

      <div className="space-y-3 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-6">
        <MetricRow label="Revenue (net of VAT)" value={report.revenue} />
        <MetricRow label="COGS" value={report.cogs} />
        <MetricRow
          label="Gross Profit"
          value={report.gross_profit}
          emphasis
        />

        <details className="border-t border-zinc-100 pt-3">
          <summary className="cursor-pointer">
            <span className="inline-flex w-[calc(100%-1.25rem)] items-baseline justify-between gap-4">
              <span className="text-zinc-500">Opex</span>
              <span className="tabular-nums font-medium text-zinc-900">
                {formatMoney(report.opex)}
              </span>
            </span>
          </summary>
          {report.opex_breakdown.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-500">
              No opex accounts with activity in this period.
            </p>
          ) : (
            <ul className="mt-3 space-y-2 border-t border-zinc-100 pt-3">
              {report.opex_breakdown.map((line) => (
                <li
                  key={line.account_code}
                  className="flex items-baseline justify-between gap-4 text-sm"
                >
                  <span className="text-zinc-600">
                    {line.account_code} {line.account_name}
                  </span>
                  <span className="tabular-nums text-zinc-900">
                    {formatMoney(line.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </details>

        <MetricRow label="Write-offs" value={report.write_offs} />
        <MetricRow label="Depreciation" value={report.depreciation} />
        <div className="border-t border-zinc-200 pt-3">
          <MetricRow
            label="Net Profit"
            value={report.net_profit}
            emphasis
          />
        </div>
      </div>
    </div>
  );
}

export function ProfitAndLossReportView({
  report,
  loading,
  error,
  onRetry,
}: ProfitAndLossReportViewProps) {
  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center">
        <p className="text-base font-medium text-red-800">
          Failed to load profit and loss
        </p>
        <p className="mt-2 text-sm text-red-600">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-6 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700"
        >
          Try again
        </button>
      </div>
    );
  }

  if (loading) {
    return <ProfitAndLossSkeleton />;
  }

  if (!report) {
    return null;
  }

  return <ProfitAndLossBody report={report} />;
}
