"use client";

import type { ReactNode } from "react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { formatDate } from "@/lib/date";
import { formatMoney } from "@/lib/money";
import { useBtwReport } from "../hooks/use-btw-report";
import type { BtwBalanceDirection, BtwReport } from "../types/btw-report";

function yearOptions(currentYear: number): number[] {
  return [currentYear, currentYear - 1, currentYear - 2, currentYear - 3];
}

function balanceLabel(direction: BtwBalanceDirection): string {
  if (direction === "to_pay") {
    return "You owe";
  }
  if (direction === "to_receive") {
    return "You are owed";
  }
  return "Balanced";
}

function RubriekCard(props: {
  title: string;
  children: ReactNode;
  emphasis?: boolean;
}) {
  return (
    <article
      className={
        props.emphasis
          ? "rounded-xl border border-amber-200 bg-amber-50/70 p-5 shadow-sm sm:p-6"
          : "rounded-xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-6"
      }
    >
      <h2 className="text-sm font-semibold tracking-tight text-zinc-900 sm:text-base">
        {props.title}
      </h2>
      <div className="mt-4 space-y-2 text-sm text-zinc-700">{props.children}</div>
    </article>
  );
}

function MetricRow(props: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-zinc-500">{props.label}</span>
      <span className="tabular-nums font-medium text-zinc-900">
        {props.value}
      </span>
    </div>
  );
}

function BtwReportBody({ report }: { report: BtwReport }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-600">
        Period {formatDate(report.period_start)} – {formatDate(report.period_end)}.
        Figures come from posted journal lines only and are recomputed for the
        selected quarter.
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        <RubriekCard title="1a — Sales at 21%">
          <MetricRow
            label="Revenue (excl. VAT)"
            value={formatMoney(report.rubriek_1a_revenue)}
          />
          <MetricRow label="VAT" value={formatMoney(report.rubriek_1a_vat)} />
          <p className="pt-1 text-xs text-zinc-500">
            Always zero — alcohol is not sold.
          </p>
        </RubriekCard>

        <RubriekCard title="1b — Sales at 9%">
          <MetricRow
            label="Revenue (excl. VAT)"
            value={formatMoney(report.rubriek_1b_revenue)}
          />
          <MetricRow label="VAT" value={formatMoney(report.rubriek_1b_vat)} />
        </RubriekCard>

        <RubriekCard title="5a — Total VAT due">
          <MetricRow
            label="1a + 1b VAT"
            value={formatMoney(report.rubriek_5a_total_vat_due)}
          />
        </RubriekCard>

        <RubriekCard title="5b — Input VAT deductible">
          <MetricRow
            label="VAT Input"
            value={formatMoney(report.rubriek_5b_input_vat_deductible)}
          />
        </RubriekCard>

        <RubriekCard title="5c — Balance" emphasis>
          <MetricRow
            label="5a − 5b"
            value={formatMoney(report.rubriek_5c_balance)}
          />
          <p className="pt-2 text-base font-semibold text-zinc-900">
            {balanceLabel(report.balance_direction)}
          </p>
        </RubriekCard>
      </div>
    </div>
  );
}

export function BtwReportPage() {
  const currentYear = new Date().getFullYear();
  const {
    year,
    quarter,
    report,
    loading,
    error,
    onPeriodChange,
    retry,
  } = useBtwReport();

  return (
    <DashboardLayout activePath="/reports/btw">
      <div className="mx-auto max-w-5xl space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl">
            BTW Report
          </h1>
          <p className="mt-2 text-base text-zinc-600 sm:text-lg">
            Quarterly Netherlands VAT declaration (rubrieken 1a, 1b, 5a, 5b,
            5c).
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700">
            Year
            <select
              value={year}
              onChange={(event) =>
                onPeriodChange(Number(event.target.value), quarter)
              }
              className="w-full rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm text-zinc-900 shadow-sm outline-none transition-colors focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 sm:w-40"
            >
              {yearOptions(currentYear).map((optionYear) => (
                <option key={optionYear} value={optionYear}>
                  {optionYear}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700">
            Quarter
            <select
              value={quarter}
              onChange={(event) =>
                onPeriodChange(year, Number(event.target.value))
              }
              className="w-full rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm text-zinc-900 shadow-sm outline-none transition-colors focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 sm:w-40"
            >
              <option value={1}>Q1</option>
              <option value={2}>Q2</option>
              <option value={3}>Q3</option>
              <option value={4}>Q4</option>
            </select>
          </label>
        </div>

        {loading ? (
          <div
            className="rounded-xl border border-zinc-200 bg-white p-8 text-center text-zinc-600 shadow-sm"
            role="status"
            aria-live="polite"
          >
            Loading BTW report...
          </div>
        ) : null}

        {!loading && error ? (
          <div
            className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-800 shadow-sm"
            role="alert"
          >
            <p className="font-medium">Could not load BTW report</p>
            <p className="mt-1 text-sm">{error}</p>
            <button
              type="button"
              onClick={() => {
                void retry();
              }}
              className="mt-4 rounded-lg bg-red-700 px-3 py-2 text-sm font-medium text-white hover:bg-red-800"
            >
              Retry
            </button>
          </div>
        ) : null}

        {!loading && !error && report ? <BtwReportBody report={report} /> : null}
      </div>
    </DashboardLayout>
  );
}
