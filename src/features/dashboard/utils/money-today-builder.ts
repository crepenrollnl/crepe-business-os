/**
 * Money Today pure builder (Dashboard redesign — Block 2).
 *
 * Consolidates revenue/profit facts that used to be duplicated across
 * Today's Summary, Key Indicators, and the Shift Details Close Day Review.
 * Projects from Dashboard Read Model facts only — never recalculates.
 */

import { formatMoney } from "@/lib/money";
import type { DashboardReadModel } from "../types/dashboard-read-model";
import type { MoneyTodayField, MoneyTodayModel } from "../types/dashboard-completion";

interface BuildMoneyTodayDailySalesSummary {
  sales_count: number;
  items_sold: number;
  gross_revenue: number;
  net_revenue: number;
}

interface BuildMoneyTodayDailyProfitSummary {
  gross_profit: number;
  total_cogs: number;
  gross_margin_percent: number | null;
}

export interface BuildMoneyTodayInput {
  current_shift: { id: string } | null;
  latest_closed_shift: { id: string } | null;
  daily_sales_summary: BuildMoneyTodayDailySalesSummary | null;
  daily_profit_summary: BuildMoneyTodayDailyProfitSummary | null;
}

function formatCount(value: number): string {
  return String(value);
}

function formatQuantity(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }
  return value.toFixed(3).replace(/\.?0+$/, "");
}

function formatMarginPercent(value: number | null): string {
  if (value === null) {
    return "—";
  }
  return `${value.toFixed(2)}%`;
}

function missingField(id: string, label: string): MoneyTodayField {
  return { id, label, display_value: "—", availability: "missing" };
}

function resolveSource(
  input: Pick<BuildMoneyTodayInput, "current_shift" | "latest_closed_shift" | "daily_sales_summary" | "daily_profit_summary">,
): { source: MoneyTodayModel["source"]; source_label: string } {
  if (input.current_shift) {
    return {
      source: "pending",
      source_label: "Shift not closed yet — figures pending.",
    };
  }

  if (!input.latest_closed_shift) {
    return {
      source: "unavailable",
      source_label: "No shift data yet.",
    };
  }

  if (!input.daily_sales_summary || !input.daily_profit_summary) {
    return {
      source: "pending",
      source_label: "Shift closed — figures pending.",
    };
  }

  return {
    source: "closed_shift_summary",
    source_label: "From the last closed shift's summary.",
  };
}

/**
 * Build the Money Today block from read-model facts.
 */
export function buildMoneyToday(
  input: BuildMoneyTodayInput,
): { data: MoneyTodayModel; error: string | null } {
  const { source, source_label } = resolveSource(input);
  const sales = input.daily_sales_summary;
  const profit = input.daily_profit_summary;

  const revenue: MoneyTodayField = sales
    ? {
        id: "revenue",
        label: "Revenue",
        display_value: formatMoney(sales.gross_revenue),
        availability: "available",
      }
    : missingField("revenue", "Revenue");

  const profitField: MoneyTodayField = profit
    ? {
        id: "profit",
        label: "Profit",
        display_value: formatMoney(profit.gross_profit),
        availability: "available",
      }
    : missingField("profit", "Profit");

  const details: MoneyTodayField[] = [
    sales
      ? {
          id: "sales_count",
          label: "Sales count",
          display_value: formatCount(sales.sales_count),
          availability: "available",
        }
      : missingField("sales_count", "Sales count"),
    sales
      ? {
          id: "items_sold",
          label: "Items sold",
          display_value: formatQuantity(sales.items_sold),
          availability: "available",
        }
      : missingField("items_sold", "Items sold"),
    sales
      ? {
          id: "net_revenue",
          label: "Net revenue",
          display_value: formatMoney(sales.net_revenue),
          availability: "available",
        }
      : missingField("net_revenue", "Net revenue"),
    profit
      ? {
          id: "total_cogs",
          label: "Total COGS",
          display_value: formatMoney(profit.total_cogs),
          availability: "available",
        }
      : missingField("total_cogs", "Total COGS"),
    profit
      ? {
          id: "gross_margin_percent",
          label: "Gross Margin %",
          display_value: formatMarginPercent(profit.gross_margin_percent),
          availability: "available",
        }
      : missingField("gross_margin_percent", "Gross Margin %"),
  ];

  return {
    data: { source, source_label, revenue, profit: profitField, details },
    error: null,
  };
}

/**
 * Project Money Today from a full Dashboard Read Model.
 */
export function buildMoneyTodayFromReadModel(
  readModel: DashboardReadModel,
): { data: MoneyTodayModel; error: string | null } {
  return buildMoneyToday({
    current_shift: readModel.current_shift
      ? { id: readModel.current_shift.id }
      : null,
    latest_closed_shift: readModel.latest_closed_shift
      ? { id: readModel.latest_closed_shift.id }
      : null,
    daily_sales_summary: readModel.daily_sales_summary
      ? {
          sales_count: readModel.daily_sales_summary.sales_count,
          items_sold: readModel.daily_sales_summary.items_sold,
          gross_revenue: readModel.daily_sales_summary.gross_revenue,
          net_revenue: readModel.daily_sales_summary.net_revenue,
        }
      : null,
    daily_profit_summary: readModel.daily_profit_summary
      ? {
          gross_profit: readModel.daily_profit_summary.gross_profit,
          total_cogs: readModel.daily_profit_summary.total_cogs,
          gross_margin_percent:
            readModel.daily_profit_summary.gross_margin_percent,
        }
      : null,
  });
}
