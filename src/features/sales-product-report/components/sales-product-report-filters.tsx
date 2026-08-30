"use client";

import type { SalesByProductPreset } from "../types/sales-product-report";

type SalesProductReportFiltersProps = {
  preset: SalesByProductPreset;
  customFrom: string;
  customTo: string;
  search: string;
  onPresetChange: (preset: SalesByProductPreset) => void;
  onCustomFromChange: (value: string) => void;
  onCustomToChange: (value: string) => void;
  onSearchChange: (value: string) => void;
};

const PRESETS: { id: SalesByProductPreset; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "this_shift", label: "This shift" },
  { id: "this_week", label: "This week" },
  { id: "custom", label: "Custom" },
];

function tabClassName(isActive: boolean): string {
  return `rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
    isActive
      ? "bg-white text-zinc-900 shadow-sm"
      : "text-zinc-600 hover:text-zinc-900"
  }`;
}

export function SalesProductReportFilters({
  preset,
  customFrom,
  customTo,
  search,
  onPresetChange,
  onCustomFromChange,
  onCustomToChange,
  onSearchChange,
}: SalesProductReportFiltersProps) {
  return (
    <div className="space-y-4">
      <div className="inline-flex flex-wrap items-center gap-1 rounded-xl bg-zinc-100 p-1">
        {PRESETS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={tabClassName(preset === item.id)}
            onClick={() => {
              onPresetChange(item.id);
            }}
          >
            {item.label}
          </button>
        ))}
      </div>

      {preset === "custom" ? (
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
      ) : null}

      <label className="flex max-w-sm flex-col gap-1 text-sm font-medium text-zinc-700">
        Search
        <input
          type="search"
          value={search}
          placeholder="Product name"
          onChange={(event) => {
            onSearchChange(event.target.value);
          }}
          className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm text-zinc-900 shadow-sm outline-none transition-colors focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20"
        />
      </label>
    </div>
  );
}
