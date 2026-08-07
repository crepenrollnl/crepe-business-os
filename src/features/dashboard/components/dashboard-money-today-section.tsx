"use client";

import { useState } from "react";
import type { MoneyTodayModel } from "../types/dashboard-completion";

type DashboardMoneyTodaySectionProps = {
  model: MoneyTodayModel;
};

/**
 * Block 2 of the redesigned dashboard — "Money Today" (DEV-126.3).
 * Consolidates Revenue/Profit headline figures that used to be duplicated
 * across Today's Summary, Key Indicators, and the Shift Details Close Day
 * Review. Presentational only — values come pre-formatted from the builder.
 */
export function DashboardMoneyTodaySection({
  model,
}: DashboardMoneyTodaySectionProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);

  return (
    <section
      className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm"
      aria-label="Money today"
      data-testid="dashboard-money-today"
    >
      <div>
        <h3 className="text-lg font-semibold text-zinc-900">Money Today</h3>
        <p
          className="mt-1 text-sm text-zinc-600"
          data-testid="money-today-source"
        >
          {model.source_label}
        </p>
      </div>

      <dl className="mt-5 grid gap-6 sm:grid-cols-2">
        <div data-testid="money-today-revenue">
          <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            {model.revenue.label}
          </dt>
          <dd
            className="mt-2 text-3xl font-semibold tracking-tight tabular-nums text-zinc-900"
            data-testid="money-today-revenue-value"
          >
            {model.revenue.display_value}
          </dd>
        </div>
        <div
          className="sm:border-l sm:border-zinc-100 sm:pl-6"
          data-testid="money-today-profit"
        >
          <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            {model.profit.label}
          </dt>
          <dd
            className="mt-2 text-3xl font-semibold tracking-tight tabular-nums text-zinc-900"
            data-testid="money-today-profit-value"
          >
            {model.profit.display_value}
          </dd>
        </div>
      </dl>

      <button
        type="button"
        aria-expanded={detailsOpen}
        aria-controls="money-today-details-panel"
        onClick={() => setDetailsOpen((current) => !current)}
        data-testid="money-today-details-toggle"
        className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-zinc-600 transition-colors hover:text-zinc-900"
      >
        {detailsOpen ? "Hide details" : "Show details"}
        <span
          aria-hidden
          className={`inline-block text-xs transition-transform ${
            detailsOpen ? "rotate-180" : ""
          }`}
        >
          ▾
        </span>
      </button>

      {detailsOpen ? (
        <dl
          id="money-today-details-panel"
          className="mt-4 grid gap-4 border-t border-zinc-100 pt-4 sm:grid-cols-3"
          data-testid="money-today-details-panel"
        >
          {model.details.map((field) => (
            <div key={field.id} data-testid={`money-today-detail-${field.id}`}>
              <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                {field.label}
              </dt>
              <dd className="mt-1 text-base font-semibold text-zinc-800">
                {field.display_value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  );
}
