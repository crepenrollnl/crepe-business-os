"use client";

import { formatMoney } from "@/lib/money";
import type { RecipeCostReportRow } from "../types/recipe-cost-report";
import {
  formatRecipeCostYield,
  recipeCostRoleLabel,
} from "../utils/recipe-cost-labels";

interface RecipeCostReportTableProps {
  rows: RecipeCostReportRow[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onOpenDetail: (row: RecipeCostReportRow) => void;
}

function moneyOrDash(value: number | null): string {
  return value === null ? "—" : formatMoney(value);
}

function getStatusBadgeClass(isActive: boolean): string {
  if (isActive) {
    return "bg-green-100 text-green-700";
  }
  return "bg-zinc-100 text-zinc-600";
}

function missingIngredientNames(row: RecipeCostReportRow): string {
  if (!row.missing_ingredients || row.missing_ingredients.length === 0) {
    return "";
  }
  return row.missing_ingredients.map((item) => item.ingredient_name).join(", ");
}

function RecipeCostReportSkeleton() {
  return (
    <>
      {Array.from({ length: 5 }).map((_, index) => (
        <tr key={index} className="border-t border-zinc-200">
          {Array.from({ length: 8 }).map((__, cellIndex) => (
            <td key={cellIndex} className="px-4 py-4">
              <div className="h-4 animate-pulse rounded bg-zinc-200" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

function RecipeCostReportRowView({
  row,
  onOpenDetail,
}: {
  row: RecipeCostReportRow;
  onOpenDetail: (row: RecipeCostReportRow) => void;
}) {
  const missingNames = missingIngredientNames(row);

  return (
    <tr
      className="cursor-pointer border-t border-zinc-200 transition-colors hover:bg-zinc-50"
      onClick={() => onOpenDetail(row)}
    >
      <td className="px-4 py-4">
        <div className="font-medium text-zinc-900">{row.recipe_name}</div>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {row.has_missing_cost_data ? (
            <span
              className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800"
              title={missingNames}
            >
              Incomplete cost data
            </span>
          ) : null}
          {row.calculation_error ? (
            <span
              className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-800"
              title={row.calculation_error}
            >
              Calculation error
            </span>
          ) : null}
        </div>
      </td>
      <td className="px-4 py-4 text-sm text-zinc-700">
        {recipeCostRoleLabel(row.recipe_role)}
      </td>
      <td className="px-4 py-4 text-sm text-zinc-700">
        {formatRecipeCostYield(row.yield_quantity, row.yield_unit)}
      </td>
      <td className="px-4 py-4 text-sm tabular-nums text-zinc-900">
        {moneyOrDash(row.total_cost)}
      </td>
      <td className="px-4 py-4 text-sm tabular-nums text-zinc-900">
        {moneyOrDash(row.cost_per_yield_unit)}
      </td>
      <td className="px-4 py-4 text-sm tabular-nums text-zinc-900">
        {moneyOrDash(row.selling_price)}
      </td>
      <td className="px-4 py-4">
        <span
          className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${getStatusBadgeClass(
            row.is_active,
          )}`}
        >
          {row.is_active ? "Active" : "Inactive"}
        </span>
      </td>
      <td className="px-4 py-4 text-right">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onOpenDetail(row);
          }}
          className="rounded-lg px-3 py-1.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
        >
          Details
        </button>
      </td>
    </tr>
  );
}

export function RecipeCostReportTable({
  rows,
  loading,
  error,
  onRetry,
  onOpenDetail,
}: RecipeCostReportTableProps) {
  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center">
        <p className="text-base font-medium text-red-800">
          Failed to load recipe cost
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

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-zinc-200 text-left text-sm">
          <thead className="bg-zinc-50 text-xs font-medium uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-4 py-3">Recipe name</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Yield</th>
              <th className="px-4 py-3">Total cost</th>
              <th className="px-4 py-3">Cost per yield unit</th>
              <th className="px-4 py-3">Selling price</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">
                <span className="sr-only">Details</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <RecipeCostReportSkeleton />
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-16 text-center">
                  <p className="text-base font-medium text-zinc-900">
                    No recipes yet
                  </p>
                  <p className="mt-2 text-sm text-zinc-500">
                    Recipe costs appear here once recipes exist.
                  </p>
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <RecipeCostReportRowView
                  key={row.recipe_id}
                  row={row}
                  onOpenDetail={onOpenDetail}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
