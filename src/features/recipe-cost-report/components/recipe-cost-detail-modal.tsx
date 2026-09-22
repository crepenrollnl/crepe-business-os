"use client";

import { formatMoney } from "@/lib/money";
import type { RecipeCostDetail } from "../types/recipe-cost-report";
import { formatRecipeCostYield } from "../utils/recipe-cost-labels";

interface RecipeCostDetailModalProps {
  isOpen: boolean;
  recipeName: string | null;
  detail: RecipeCostDetail | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}

function formatQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}

function moneyOrDash(value: number | null): string {
  return value === null ? "—" : formatMoney(value);
}

export function RecipeCostDetailModal({
  isOpen,
  recipeName,
  detail,
  loading,
  error,
  onClose,
}: RecipeCostDetailModalProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 bg-zinc-900/50"
        onClick={onClose}
      />

      <div
        className="relative max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-zinc-200 bg-white p-6 shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="recipe-cost-detail-title"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2
            id="recipe-cost-detail-title"
            className="text-xl font-semibold text-zinc-900"
          >
            {recipeName ?? "Recipe cost"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
          >
            Close
          </button>
        </div>

        {loading ? (
          <div className="space-y-4" role="status" aria-live="polite">
            <div className="h-5 w-48 animate-pulse rounded bg-zinc-200" />
            <div className="h-32 animate-pulse rounded bg-zinc-200" />
          </div>
        ) : error ? (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {error}
          </div>
        ) : detail ? (
          <div className="space-y-4">
            <dl className="grid gap-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Yield
                </dt>
                <dd className="mt-0.5 text-zinc-800">
                  {formatRecipeCostYield(
                    detail.yield_quantity,
                    detail.yield_unit,
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Total cost
                </dt>
                <dd className="mt-0.5 tabular-nums text-zinc-800">
                  {moneyOrDash(detail.total_cost)}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Cost per {detail.yield_unit}
                </dt>
                <dd className="mt-0.5 tabular-nums text-zinc-800">
                  {moneyOrDash(detail.cost_per_yield_unit)}
                </dd>
              </div>
            </dl>

            {detail.ingredient_breakdown.length === 0 ? (
              <p className="text-sm text-zinc-500">
                No ingredient lines for this recipe.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-zinc-200">
                <table className="min-w-full divide-y divide-zinc-200 text-left text-sm">
                  <thead className="bg-zinc-50 text-xs font-medium uppercase tracking-wide text-zinc-500">
                    <tr>
                      <th className="px-3 py-2">Ingredient</th>
                      <th className="px-3 py-2">Quantity</th>
                      <th className="px-3 py-2">Cost per unit</th>
                      <th className="px-3 py-2">Line cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.ingredient_breakdown.map((line) => (
                      <tr
                        key={line.ingredient_id}
                        className="border-t border-zinc-200"
                      >
                        <td className="px-3 py-2 text-zinc-900">
                          {line.ingredient_name}
                        </td>
                        <td className="px-3 py-2 text-zinc-700">
                          {formatQuantity(line.quantity)} {line.unit}
                        </td>
                        <td className="px-3 py-2 tabular-nums text-zinc-900">
                          {moneyOrDash(line.cost_per_unit)}
                        </td>
                        <td className="px-3 py-2 tabular-nums text-zinc-900">
                          {formatMoney(line.line_cost)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
