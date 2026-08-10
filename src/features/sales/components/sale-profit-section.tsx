import type { SaleProfitSummary } from "../types/sale-profit";
import { formatSaleMoney } from "../utils/format-sale";

type SaleProfitSectionProps = {
  summary: SaleProfitSummary | null;
  loading?: boolean;
  error?: string | null;
};

function formatMarginPercent(value: number | null): string {
  if (value === null) {
    return "—";
  }
  return `${value.toFixed(2)}%`;
}

export function SaleProfitSection({
  summary,
  loading = false,
  error = null,
}: SaleProfitSectionProps) {
  if (loading) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white px-4 py-6 text-sm text-zinc-500 shadow-sm">
        Loading profit summary…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800 shadow-sm">
        {error}
      </div>
    );
  }

  if (!summary) {
    return null;
  }

  return (
    <div
      className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm"
      data-testid="sale-profit-section"
    >
      <div className="border-b border-zinc-200 px-4 py-4">
        <h2 className="text-base font-semibold text-zinc-900">
          Profit Summary
        </h2>
        <p className="mt-0.5 text-sm text-zinc-500">
          Frozen after confirmation from net revenue (ex-VAT) and frozen COGS.
          Never recalculated.
        </p>
      </div>
      <dl className="grid gap-4 px-4 py-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Revenue
          </dt>
          <dd
            className="mt-0.5 text-base font-semibold text-zinc-900"
            data-testid="sale-net-revenue"
          >
            {formatSaleMoney(summary.net_revenue)}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            COGS
          </dt>
          <dd
            className="mt-0.5 text-base font-semibold text-zinc-900"
            data-testid="sale-profit-cogs"
          >
            {formatSaleMoney(summary.cogs)}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Gross Profit
          </dt>
          <dd
            className="mt-0.5 text-base font-semibold text-zinc-900"
            data-testid="sale-gross-profit"
          >
            {formatSaleMoney(summary.gross_profit)}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Gross Margin %
          </dt>
          <dd
            className="mt-0.5 text-base font-semibold text-zinc-900"
            data-testid="sale-gross-margin"
          >
            {formatMarginPercent(summary.gross_margin_percent)}
          </dd>
        </div>
      </dl>
    </div>
  );
}
