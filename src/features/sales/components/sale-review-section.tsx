/**
 * Sale Details review panel (DEV-111).
 *
 * Display-only: formats existing frozen sale / COGS / profit / posting facts.
 * Never recalculates financial values in the UI.
 */

import { formatUnitCost } from "@/lib/money";
import type { SaleAccountingPostingStatus } from "../types/sale-accounting";
import type { SaleCostSummary } from "../types/sale-cogs";
import type { SaleProfitSummary } from "../types/sale-profit";
import type { SaleDetail } from "../types/sale";
import {
  formatSaleDateTime,
  formatSaleMoney,
} from "../utils/format-sale";

type SaleReviewSectionProps = {
  sale: SaleDetail;
  cogsSummary?: SaleCostSummary | null;
  profitSummary?: SaleProfitSummary | null;
  accountingPostingStatus?: SaleAccountingPostingStatus;
  cogsError?: string | null;
  profitError?: string | null;
  loading?: boolean;
};

function formatMarginPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "—";
  }
  return `${value.toFixed(2)}%`;
}

function formatPostingStatus(
  status: SaleAccountingPostingStatus | undefined,
): string {
  return status === "posted" ? "✓ Posted" : "Pending";
}

function formatQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}

export function SaleReviewSection({
  sale,
  cogsSummary = null,
  profitSummary = null,
  accountingPostingStatus = "pending",
  cogsError = null,
  profitError = null,
  loading = false,
}: SaleReviewSectionProps) {
  const isDraft = sale.status === "draft";
  const isCompleted =
    sale.status === "confirmed" || sale.status === "paid";

  if (loading) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white px-4 py-6 text-sm text-zinc-500 shadow-sm">
        Loading sale review…
      </div>
    );
  }

  if (isDraft) {
    return (
      <div
        className="rounded-xl border border-zinc-200 bg-white px-4 py-4 text-sm text-zinc-600 shadow-sm"
        data-testid="sale-review-section"
      >
        <h2 className="text-base font-semibold text-zinc-900">Sale Review</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Confirm this sale to freeze COGS, profit, and accounting posting
          status.
        </p>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Sale Total
            </dt>
            <dd className="mt-0.5 text-zinc-800" data-testid="review-sale-total">
              {formatSaleMoney(sale.total)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Net Revenue
            </dt>
            <dd
              className="mt-0.5 text-zinc-800"
              data-testid="review-net-revenue"
            >
              {formatSaleMoney(sale.subtotal)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              VAT
            </dt>
            <dd className="mt-0.5 text-zinc-800" data-testid="review-vat">
              {formatSaleMoney(sale.tax_total)}
            </dd>
          </div>
        </dl>
      </div>
    );
  }

  const netRevenue =
    profitSummary?.net_revenue ?? (isCompleted ? sale.subtotal : null);
  const vat = sale.tax_total;
  const saleTotal = sale.total;
  const cogs = cogsSummary?.total_cogs ?? null;
  const grossProfit = profitSummary?.gross_profit ?? null;
  const margin = profitSummary?.gross_margin_percent ?? null;
  const completionDate = sale.confirmed_at;
  const postingLabel = formatPostingStatus(accountingPostingStatus);
  const layers = cogsSummary?.layers ?? [];

  return (
    <div
      className="space-y-4"
      data-testid="sale-review-section"
    >
      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
        <div className="border-b border-zinc-200 px-4 py-4">
          <h2 className="text-base font-semibold text-zinc-900">Sale Review</h2>
          <p className="mt-0.5 text-sm text-zinc-500">
            Complete business view from frozen sale, COGS, and profit records.
            Values are never recalculated in the UI.
          </p>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Sale Total
              </dt>
              <dd
                className="mt-0.5 font-semibold text-zinc-900"
                data-testid="review-sale-total"
              >
                {formatSaleMoney(saleTotal)}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Net Revenue
              </dt>
              <dd
                className="mt-0.5 text-zinc-800"
                data-testid="review-net-revenue"
              >
                {netRevenue === null ? "—" : formatSaleMoney(netRevenue)}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                VAT
              </dt>
              <dd className="mt-0.5 text-zinc-800" data-testid="review-vat">
                {formatSaleMoney(vat)}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Frozen COGS
              </dt>
              <dd className="mt-0.5 text-zinc-800" data-testid="review-cogs">
                {cogs === null ? "—" : formatSaleMoney(cogs)}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Gross Profit
              </dt>
              <dd
                className="mt-0.5 text-zinc-800"
                data-testid="review-gross-profit"
              >
                {grossProfit === null ? "—" : formatSaleMoney(grossProfit)}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Gross Margin %
              </dt>
              <dd
                className="mt-0.5 text-zinc-800"
                data-testid="review-gross-margin"
              >
                {formatMarginPercent(margin)}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Sale Completion Date
              </dt>
              <dd
                className="mt-0.5 text-zinc-800"
                data-testid="review-completion-date"
              >
                {formatSaleDateTime(completionDate)}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Accounting Posting Status
              </dt>
              <dd
                className="mt-0.5 text-zinc-800"
                data-testid="review-accounting-status"
              >
                {postingLabel}
              </dd>
            </div>
          </dl>

          {cogsError ? (
            <p
              className="mt-3 text-sm text-amber-700"
              data-testid="review-missing-cogs"
            >
              {cogsError}
            </p>
          ) : null}
          {profitError ? (
            <p
              className="mt-3 text-sm text-amber-700"
              data-testid="review-missing-profit"
            >
              {profitError}
            </p>
          ) : null}
        </div>
      </div>

      <div
        className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm"
        data-testid="review-consumed-batches"
      >
        <div className="border-b border-zinc-200 px-4 py-3">
          <h3 className="text-sm font-semibold text-zinc-900">
            Finished Goods Batches Consumed
          </h3>
          <p className="mt-0.5 text-xs text-zinc-500">
            Frozen FIFO consumption layers from confirmation.
          </p>
        </div>
        {layers.length === 0 ? (
          <p className="px-4 py-4 text-sm text-zinc-500">
            {cogsError
              ? "Batch consumption is unavailable for this sale."
              : "No Finished Goods consumption layers are recorded for this sale."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-zinc-200 text-sm">
              <thead className="bg-zinc-50 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-4 py-3">Batch</th>
                  <th className="px-4 py-3">Quantity</th>
                  <th className="px-4 py-3">Unit Cost</th>
                  <th className="px-4 py-3">Layer Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {layers.map((layer) => (
                  <tr key={layer.consumption_id}>
                    <td className="px-4 py-3 font-medium text-zinc-900">
                      {layer.batch_number !== null
                        ? `#${layer.batch_number}`
                        : layer.production_batch_id.slice(0, 8)}
                    </td>
                    <td className="px-4 py-3 text-zinc-800">
                      {formatQuantity(layer.quantity)}
                    </td>
                    <td className="px-4 py-3 text-zinc-800">
                      {formatUnitCost(layer.unit_cost)}
                    </td>
                    <td className="px-4 py-3 text-zinc-800">
                      {formatSaleMoney(layer.total_cost)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
