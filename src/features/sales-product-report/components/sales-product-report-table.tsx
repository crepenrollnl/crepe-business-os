"use client";

import { formatMoney, roundMoney } from "@/lib/money";
import { roundQuantity } from "@/lib/quantity";
import type {
  SalesByProductRow,
  SalesByProductSortDirection,
  SalesByProductSortField,
} from "../types/sales-product-report";

type SalesProductReportTableProps = {
  rows: SalesByProductRow[];
  loading: boolean;
  error: string | null;
  sortField: SalesByProductSortField;
  sortDirection: SalesByProductSortDirection;
  onSort: (field: SalesByProductSortField) => void;
  onRetry: () => void;
};

const COLUMNS: { field: SalesByProductSortField; label: string }[] = [
  { field: "product_name", label: "Product" },
  { field: "quantity", label: "Quantity" },
  { field: "revenue", label: "Revenue" },
  { field: "cogs", label: "COGS" },
  { field: "gross_profit", label: "Profit" },
  { field: "gross_margin_percent", label: "Margin %" },
];

function formatQuantity(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }
  return value.toFixed(3).replace(/\.?0+$/, "");
}

function formatMargin(value: number | null): string {
  if (value === null) {
    return "—";
  }
  return `${value.toFixed(2)}%`;
}

function sumRows(rows: SalesByProductRow[]): {
  quantity: number;
  revenue: number;
  cogs: number;
  gross_profit: number;
  gross_margin_percent: number | null;
} {
  const quantity = roundQuantity(
    rows.reduce((sum, row) => sum + row.quantity, 0),
  );
  const revenue = roundMoney(rows.reduce((sum, row) => sum + row.revenue, 0));
  const cogs = roundMoney(rows.reduce((sum, row) => sum + row.cogs, 0));
  const grossProfit = roundMoney(revenue - cogs);
  return {
    quantity,
    revenue,
    cogs,
    gross_profit: grossProfit,
    gross_margin_percent:
      revenue === 0 ? null : roundMoney((grossProfit / revenue) * 100),
  };
}

function sortMark(
  field: SalesByProductSortField,
  current: SalesByProductSortField,
  direction: SalesByProductSortDirection,
): string {
  if (field !== current) {
    return "";
  }
  return direction === "asc" ? " ↑" : " ↓";
}

export function SalesProductReportTable({
  rows,
  loading,
  error,
  sortField,
  sortDirection,
  onSort,
  onRetry,
}: SalesProductReportTableProps) {
  const totals =
    !loading && !error && rows.length > 0 ? sumRows(rows) : null;

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-zinc-200 text-sm">
          <thead className="bg-zinc-50 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
            <tr>
              {COLUMNS.map((column) => (
                <th key={column.field} className="px-4 py-3">
                  <button
                    type="button"
                    className="font-semibold uppercase tracking-wide text-zinc-500 hover:text-zinc-800"
                    onClick={() => {
                      onSort(column.field);
                    }}
                  >
                    {column.label}
                    {sortMark(column.field, sortField, sortDirection)}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {loading ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-8 text-center text-zinc-600"
                  role="status"
                >
                  Loading sales by product…
                </td>
              </tr>
            ) : null}

            {!loading && error ? (
              <tr>
                <td colSpan={6} className="px-4 py-8" role="alert">
                  <p className="font-medium text-red-800">{error}</p>
                  <button
                    type="button"
                    className="mt-3 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white"
                    onClick={onRetry}
                  >
                    Retry
                  </button>
                </td>
              </tr>
            ) : null}

            {!loading && !error && rows.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-8 text-center text-zinc-600"
                >
                  No completed sales in this period.
                </td>
              </tr>
            ) : null}

            {!loading && !error
              ? rows.map((row) => (
                  <tr key={row.product_id}>
                    <td className="px-4 py-3 font-medium text-zinc-900">
                      {row.product_name}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-zinc-800">
                      {formatQuantity(row.quantity)}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-zinc-800">
                      {formatMoney(row.revenue)}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-zinc-800">
                      {formatMoney(row.cogs)}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-zinc-800">
                      {formatMoney(row.gross_profit)}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-zinc-800">
                      {formatMargin(row.gross_margin_percent)}
                    </td>
                  </tr>
                ))
              : null}
          </tbody>
          {totals ? (
            <tfoot className="border-t border-zinc-200 bg-zinc-50 font-semibold">
              <tr>
                <td className="px-4 py-3 text-zinc-900">Total</td>
                <td className="px-4 py-3 tabular-nums text-zinc-900">
                  {formatQuantity(totals.quantity)}
                </td>
                <td className="px-4 py-3 tabular-nums text-zinc-900">
                  {formatMoney(totals.revenue)}
                </td>
                <td className="px-4 py-3 tabular-nums text-zinc-900">
                  {formatMoney(totals.cogs)}
                </td>
                <td className="px-4 py-3 tabular-nums text-zinc-900">
                  {formatMoney(totals.gross_profit)}
                </td>
                <td className="px-4 py-3 tabular-nums text-zinc-900">
                  {formatMargin(totals.gross_margin_percent)}
                </td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </div>
  );
}
