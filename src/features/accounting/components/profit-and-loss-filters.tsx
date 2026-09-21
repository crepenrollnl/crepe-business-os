"use client";

import type { ProfitAndLossPeriodMode } from "../types/profit-and-loss";

const MONTH_LABELS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

type ProfitAndLossFiltersProps = {
  mode: ProfitAndLossPeriodMode;
  year: number;
  monthIndex: number;
  customFrom: string;
  customTo: string;
  onModeChange: (mode: ProfitAndLossPeriodMode) => void;
  onMonthChange: (year: number, monthIndex: number) => void;
  onPreviousMonth: () => void;
  onNextMonth: () => void;
  onCustomFromChange: (value: string) => void;
  onCustomToChange: (value: string) => void;
};

function tabClassName(isActive: boolean): string {
  return `rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
    isActive
      ? "bg-white text-zinc-900 shadow-sm"
      : "text-zinc-600 hover:text-zinc-900"
  }`;
}

function yearOptions(selectedYear: number): number[] {
  const currentYear = new Date().getFullYear();
  const years: number[] = [];
  for (let year = currentYear + 1; year >= currentYear - 5; year -= 1) {
    years.push(year);
  }
  if (!years.includes(selectedYear)) {
    years.push(selectedYear);
    years.sort((left, right) => right - left);
  }
  return years;
}

export function ProfitAndLossFilters({
  mode,
  year,
  monthIndex,
  customFrom,
  customTo,
  onModeChange,
  onMonthChange,
  onPreviousMonth,
  onNextMonth,
  onCustomFromChange,
  onCustomToChange,
}: ProfitAndLossFiltersProps) {
  return (
    <div className="space-y-4">
      <div className="inline-flex flex-wrap items-center gap-1 rounded-xl bg-zinc-100 p-1">
        <button
          type="button"
          className={tabClassName(mode === "month")}
          onClick={() => {
            onModeChange("month");
          }}
        >
          Month
        </button>
        <button
          type="button"
          className={tabClassName(mode === "custom")}
          onClick={() => {
            onModeChange("custom");
          }}
        >
          Custom range
        </button>
      </div>

      {mode === "month" ? (
        <div className="flex flex-wrap items-end gap-3">
          <button
            type="button"
            onClick={onPreviousMonth}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm font-semibold text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50"
          >
            Previous
          </button>

          <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700">
            Month
            <select
              value={monthIndex}
              onChange={(event) => {
                onMonthChange(year, Number(event.target.value));
              }}
              className="w-full rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm text-zinc-900 shadow-sm outline-none transition-colors focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 sm:w-44"
            >
              {MONTH_LABELS.map((label, index) => (
                <option key={label} value={index}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700">
            Year
            <select
              value={year}
              onChange={(event) => {
                onMonthChange(Number(event.target.value), monthIndex);
              }}
              className="w-full rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm text-zinc-900 shadow-sm outline-none transition-colors focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 sm:w-32"
            >
              {yearOptions(year).map((optionYear) => (
                <option key={optionYear} value={optionYear}>
                  {optionYear}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={onNextMonth}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm font-semibold text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50"
          >
            Next
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-3">
          <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700">
            From
            <input
              type="date"
              value={customFrom}
              onChange={(event) => {
                onCustomFromChange(event.target.value);
              }}
              className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm text-zinc-900 shadow-sm outline-none transition-colors focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700">
            To
            <input
              type="date"
              value={customTo}
              onChange={(event) => {
                onCustomToChange(event.target.value);
              }}
              className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm text-zinc-900 shadow-sm outline-none transition-colors focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20"
            />
          </label>
        </div>
      )}
    </div>
  );
}
