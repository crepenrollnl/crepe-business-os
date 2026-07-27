/**
 * Dashboard KPI Cards pure builder (DEV-123).
 *
 * Projects display cards from Dashboard Read Model facts only.
 * Does not recalculate revenue, profit, or inventory forecasts.
 */

import type { DashboardReadModel } from "../types/dashboard-read-model";
import type {
  BuildDashboardKpiCardsInput,
  DashboardKpiCard,
  DashboardKpiCardsModel,
} from "../types/dashboard-kpi-cards";

function formatMoney(value: number): string {
  return `€${value.toFixed(2)}`;
}

function formatCount(value: number): string {
  return String(value);
}

function countCriticalAlerts(
  alerts: BuildDashboardKpiCardsInput["low_stock_alerts"],
): number | null {
  if (alerts === null) {
    return null;
  }

  let count = 0;
  for (const alert of alerts) {
    if (alert.alert_level === "critical") {
      count += 1;
    }
  }
  return count;
}

function buildGrossRevenueCard(
  input: BuildDashboardKpiCardsInput,
): DashboardKpiCard {
  const summary = input.daily_sales_summary;

  if (!summary) {
    return {
      id: "gross_revenue",
      title: "Gross Revenue",
      display_value: "—",
      numeric_value: null,
      availability: "missing",
      detail: "Daily sales summary is not available.",
    };
  }

  return {
    id: "gross_revenue",
    title: "Gross Revenue",
    display_value: formatMoney(summary.gross_revenue),
    numeric_value: summary.gross_revenue,
    availability: "available",
    detail: "From the frozen daily sales summary.",
  };
}

function buildGrossProfitCard(
  input: BuildDashboardKpiCardsInput,
): DashboardKpiCard {
  const summary = input.daily_profit_summary;

  if (!summary) {
    return {
      id: "gross_profit",
      title: "Gross Profit",
      display_value: "—",
      numeric_value: null,
      availability: "missing",
      detail: "Daily profit summary is not available.",
    };
  }

  return {
    id: "gross_profit",
    title: "Gross Profit",
    display_value: formatMoney(summary.gross_profit),
    numeric_value: summary.gross_profit,
    availability: "available",
    detail: "From the frozen daily profit summary.",
  };
}

function buildActiveShiftStatusCard(
  input: BuildDashboardKpiCardsInput,
): DashboardKpiCard {
  const shift = input.current_shift;

  if (!shift) {
    return {
      id: "active_shift_status",
      title: "Active Shift Status",
      display_value: "None",
      numeric_value: null,
      availability: "empty",
      detail: "No open shift.",
    };
  }

  return {
    id: "active_shift_status",
    title: "Active Shift Status",
    display_value: "Open",
    numeric_value: null,
    availability: "available",
    detail: `Opened ${shift.opened_at}`,
  };
}

function buildCriticalInventoryAlertsCard(
  input: BuildDashboardKpiCardsInput,
): DashboardKpiCard {
  const criticalCount = countCriticalAlerts(input.low_stock_alerts);

  if (criticalCount === null) {
    return {
      id: "critical_inventory_alerts",
      title: "Critical Inventory Alerts",
      display_value: "—",
      numeric_value: null,
      availability: "missing",
      detail: "Low stock alerts are not available.",
    };
  }

  if (criticalCount === 0) {
    return {
      id: "critical_inventory_alerts",
      title: "Critical Inventory Alerts",
      display_value: formatCount(0),
      numeric_value: 0,
      availability: "empty",
      detail: "No critical inventory alerts.",
    };
  }

  return {
    id: "critical_inventory_alerts",
    title: "Critical Inventory Alerts",
    display_value: formatCount(criticalCount),
    numeric_value: criticalCount,
    availability: "available",
    detail: "Critical alerts from the inventory advisory read model.",
  };
}

/**
 * Build the four primary KPI cards from read-model facts.
 */
export function buildDashboardKpiCards(
  input: BuildDashboardKpiCardsInput,
): { data: DashboardKpiCardsModel; error: string | null } {
  return {
    data: {
      cards: [
        buildGrossRevenueCard(input),
        buildGrossProfitCard(input),
        buildActiveShiftStatusCard(input),
        buildCriticalInventoryAlertsCard(input),
      ],
    },
    error: null,
  };
}

/**
 * Project KPI cards from a full Dashboard Read Model.
 */
export function buildDashboardKpiCardsFromReadModel(
  readModel: DashboardReadModel,
): { data: DashboardKpiCardsModel; error: string | null } {
  return buildDashboardKpiCards({
    current_shift: readModel.current_shift
      ? {
          id: readModel.current_shift.id,
          status: readModel.current_shift.status,
          opened_at: readModel.current_shift.opened_at,
        }
      : null,
    daily_sales_summary: readModel.daily_sales_summary
      ? { gross_revenue: readModel.daily_sales_summary.gross_revenue }
      : null,
    daily_profit_summary: readModel.daily_profit_summary
      ? { gross_profit: readModel.daily_profit_summary.gross_profit }
      : null,
    low_stock_alerts: readModel.low_stock_alerts,
  });
}
