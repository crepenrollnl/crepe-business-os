/**
 * Operational Dashboard pure builder (DEV-124).
 *
 * Projects operational fields from Dashboard Read Model facts only.
 * Does not recalculate sales, profit, cash, or inventory metrics.
 */

import type { DashboardReadModel } from "../types/dashboard-read-model";
import type {
  BuildOperationalDashboardInput,
  OperationalDashboardField,
  OperationalDashboardModel,
  OperationalShiftContext,
} from "../types/operational-dashboard";

function formatMoney(value: number): string {
  return `€${value.toFixed(2)}`;
}

function formatCount(value: number): string {
  return String(value);
}

function resolveShiftContext(
  input: BuildOperationalDashboardInput,
): OperationalShiftContext {
  if (input.current_shift) {
    return "open";
  }
  if (input.latest_closed_shift) {
    return "closed";
  }
  return "none";
}

function countCriticalAlerts(
  alerts: BuildOperationalDashboardInput["low_stock_alerts"],
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

function buildCurrentShiftStatusField(
  context: OperationalShiftContext,
): OperationalDashboardField {
  if (context === "open") {
    return {
      id: "current_shift_status",
      label: "Current Shift Status",
      display_value: "Open",
      numeric_value: null,
      availability: "available",
      detail: "An open shift is in progress.",
    };
  }

  if (context === "closed") {
    return {
      id: "current_shift_status",
      label: "Current Shift Status",
      display_value: "Closed",
      numeric_value: null,
      availability: "available",
      detail: "Showing the latest closed shift review context.",
    };
  }

  return {
    id: "current_shift_status",
    label: "Current Shift Status",
    display_value: "None",
    numeric_value: null,
    availability: "empty",
    detail: "No active or closed shift is available.",
  };
}

function buildShiftOpenedAtField(
  input: BuildOperationalDashboardInput,
  context: OperationalShiftContext,
): OperationalDashboardField {
  if (context === "open" && input.current_shift) {
    return {
      id: "shift_opened_at",
      label: "Shift Opened At",
      display_value: input.current_shift.opened_at,
      numeric_value: null,
      availability: "available",
      detail: null,
    };
  }

  if (context === "closed" && input.latest_closed_shift) {
    return {
      id: "shift_opened_at",
      label: "Shift Opened At",
      display_value: input.latest_closed_shift.opened_at,
      numeric_value: null,
      availability: "available",
      detail: null,
    };
  }

  return {
    id: "shift_opened_at",
    label: "Shift Opened At",
    display_value: "—",
    numeric_value: null,
    availability: "missing",
    detail: "Shift open time is not available.",
  };
}

function buildSalesTodayField(
  input: BuildOperationalDashboardInput,
): OperationalDashboardField {
  const summary = input.daily_sales_summary;
  if (!summary) {
    return {
      id: "sales_today",
      label: "Sales Today",
      display_value: "—",
      numeric_value: null,
      availability: "missing",
      detail: "Daily sales summary is not available.",
    };
  }

  return {
    id: "sales_today",
    label: "Sales Today",
    display_value: formatCount(summary.sales_count),
    numeric_value: summary.sales_count,
    availability: "available",
    detail: "From the frozen daily sales summary.",
  };
}

function buildNetRevenueTodayField(
  input: BuildOperationalDashboardInput,
): OperationalDashboardField {
  const summary = input.daily_sales_summary;
  if (!summary) {
    return {
      id: "net_revenue_today",
      label: "Net Revenue Today",
      display_value: "—",
      numeric_value: null,
      availability: "missing",
      detail: "Daily sales summary is not available.",
    };
  }

  return {
    id: "net_revenue_today",
    label: "Net Revenue Today",
    display_value: formatMoney(summary.net_revenue),
    numeric_value: summary.net_revenue,
    availability: "available",
    detail: "From the frozen daily sales summary.",
  };
}

function buildGrossProfitTodayField(
  input: BuildOperationalDashboardInput,
): OperationalDashboardField {
  const summary = input.daily_profit_summary;
  if (!summary) {
    return {
      id: "gross_profit_today",
      label: "Gross Profit Today",
      display_value: "—",
      numeric_value: null,
      availability: "missing",
      detail: "Daily profit summary is not available.",
    };
  }

  return {
    id: "gross_profit_today",
    label: "Gross Profit Today",
    display_value: formatMoney(summary.gross_profit),
    numeric_value: summary.gross_profit,
    availability: "available",
    detail: "From the frozen daily profit summary.",
  };
}

function buildCashReconciliationStatusField(
  input: BuildOperationalDashboardInput,
  context: OperationalShiftContext,
): OperationalDashboardField {
  if (context !== "closed") {
    return {
      id: "cash_reconciliation_status",
      label: "Cash Reconciliation Status",
      display_value: "—",
      numeric_value: null,
      availability: "not_applicable",
      detail: "Shown only when the latest shift is closed.",
    };
  }

  if (!input.cash_reconciliation) {
    return {
      id: "cash_reconciliation_status",
      label: "Cash Reconciliation Status",
      display_value: "Pending",
      numeric_value: null,
      availability: "empty",
      detail: "Closed shift has not been reconciled yet.",
    };
  }

  const difference = input.cash_reconciliation.difference;
  const balanced = difference === 0;

  return {
    id: "cash_reconciliation_status",
    label: "Cash Reconciliation Status",
    display_value: balanced ? "Balanced" : "Difference",
    numeric_value: difference,
    availability: "available",
    detail: balanced
      ? "Stored reconciliation difference is zero."
      : `Stored difference ${formatMoney(difference)}.`,
  };
}

function buildCriticalInventoryAlertsField(
  input: BuildOperationalDashboardInput,
): OperationalDashboardField {
  const criticalCount = countCriticalAlerts(input.low_stock_alerts);

  if (criticalCount === null) {
    return {
      id: "critical_inventory_alerts",
      label: "Critical Inventory Alerts",
      display_value: "—",
      numeric_value: null,
      availability: "missing",
      detail: "Low stock alerts are not available.",
    };
  }

  if (criticalCount === 0) {
    return {
      id: "critical_inventory_alerts",
      label: "Critical Inventory Alerts",
      display_value: formatCount(0),
      numeric_value: 0,
      availability: "empty",
      detail: "No critical inventory alerts.",
    };
  }

  return {
    id: "critical_inventory_alerts",
    label: "Critical Inventory Alerts",
    display_value: formatCount(criticalCount),
    numeric_value: criticalCount,
    availability: "available",
    detail: "Critical alerts from the inventory advisory read model.",
  };
}

/**
 * Build the operational dashboard section from read-model facts.
 */
export function buildOperationalDashboard(
  input: BuildOperationalDashboardInput,
): { data: OperationalDashboardModel; error: string | null } {
  const shiftContext = resolveShiftContext(input);

  return {
    data: {
      shift_context: shiftContext,
      fields: [
        buildCurrentShiftStatusField(shiftContext),
        buildShiftOpenedAtField(input, shiftContext),
        buildSalesTodayField(input),
        buildNetRevenueTodayField(input),
        buildGrossProfitTodayField(input),
        buildCashReconciliationStatusField(input, shiftContext),
        buildCriticalInventoryAlertsField(input),
      ],
    },
    error: null,
  };
}

/**
 * Project the operational dashboard from a full Dashboard Read Model.
 */
export function buildOperationalDashboardFromReadModel(
  readModel: DashboardReadModel,
): { data: OperationalDashboardModel; error: string | null } {
  return buildOperationalDashboard({
    current_shift: readModel.current_shift
      ? {
          id: readModel.current_shift.id,
          status: readModel.current_shift.status,
          opened_at: readModel.current_shift.opened_at,
        }
      : null,
    latest_closed_shift: readModel.latest_closed_shift
      ? {
          id: readModel.latest_closed_shift.id,
          status: readModel.latest_closed_shift.status,
          opened_at: readModel.latest_closed_shift.opened_at,
          closed_at: readModel.latest_closed_shift.closed_at,
        }
      : null,
    daily_sales_summary: readModel.daily_sales_summary
      ? {
          sales_count: readModel.daily_sales_summary.sales_count,
          net_revenue: readModel.daily_sales_summary.net_revenue,
        }
      : null,
    daily_profit_summary: readModel.daily_profit_summary
      ? { gross_profit: readModel.daily_profit_summary.gross_profit }
      : null,
    cash_reconciliation: readModel.cash_reconciliation
      ? { difference: readModel.cash_reconciliation.difference }
      : null,
    low_stock_alerts: readModel.low_stock_alerts,
  });
}
