/**
 * Dashboard Completion pure builder (DEV-126).
 *
 * Composes existing Dashboard Read Model projections into one view model.
 * Never recalculates revenue, profit, cash, or inventory metrics.
 */

import { formatMoney } from "@/lib/money";
import type { DashboardCompletionModel } from "../types/dashboard-completion";
import type { DashboardReadModel } from "../types/dashboard-read-model";
import type { DashboardSnapshotField } from "../types/dashboard-completion";
import { buildBusinessHealthFromReadModel } from "./business-health-builder";
import { buildDashboardKpiCardsFromReadModel } from "./dashboard-kpi-cards-builder";
import { dedupeInformationalMessages } from "./dashboard-resilience";
import { buildOperationalDashboardFromReadModel } from "./operational-dashboard-builder";

function buildInformationalMessages(
  readModel: DashboardReadModel,
): string[] {
  const messages: string[] = [];

  // Shift ownership stays in the Shift panel — do not duplicate here.
  // Inventory ownership stays in the Low Stock Alerts section.

  const missingDailySummaries =
    Boolean(readModel.latest_closed_shift) &&
    !readModel.current_shift &&
    (!readModel.daily_sales_summary ||
      !readModel.daily_profit_summary ||
      !readModel.cash_reconciliation);

  if (missingDailySummaries) {
    messages.push(
      "Some daily close summaries are not ready yet. Available figures still appear below.",
    );
  }

  if (readModel.kpi_summary === null) {
    messages.push(
      "Some overview metrics are temporarily unavailable. The rest of the dashboard remains usable.",
    );
  }

  return messages;
}

function buildDailySnapshotFields(
  readModel: DashboardReadModel,
): DashboardSnapshotField[] {
  const sales = readModel.daily_sales_summary;
  const profit = readModel.daily_profit_summary;
  const cash = readModel.cash_reconciliation;
  const isOpen = readModel.current_shift !== null;
  const isClosedContext =
    !isOpen && readModel.latest_closed_shift !== null;

  const dailyRevenue: DashboardSnapshotField = sales
    ? {
        id: "daily_revenue",
        label: "Daily Revenue",
        display_value: formatMoney(sales.gross_revenue),
        availability: "available",
        detail: "Gross revenue from the frozen daily sales summary.",
      }
    : {
        id: "daily_revenue",
        label: "Daily Revenue",
        display_value: "—",
        availability: "missing",
        detail: "Daily sales summary is not available.",
      };

  const dailyProfit: DashboardSnapshotField = profit
    ? {
        id: "daily_profit",
        label: "Daily Profit",
        display_value: formatMoney(profit.gross_profit),
        availability: "available",
        detail: "Gross profit from the frozen daily profit summary.",
      }
    : {
        id: "daily_profit",
        label: "Daily Profit",
        display_value: "—",
        availability: "missing",
        detail: "Daily profit summary is not available.",
      };

  let cashStatus: DashboardSnapshotField;
  if (isOpen || !isClosedContext) {
    cashStatus = {
      id: "cash_status",
      label: "Cash Status",
      display_value: "—",
      availability: "not_applicable",
      detail: "Cash status is shown for a closed shift.",
    };
  } else if (!cash) {
    cashStatus = {
      id: "cash_status",
      label: "Cash Status",
      display_value: "Pending",
      availability: "empty",
      detail: "Closed shift has not been reconciled yet.",
    };
  } else if (cash.difference === 0) {
    cashStatus = {
      id: "cash_status",
      label: "Cash Status",
      display_value: "Balanced",
      availability: "available",
      detail: "Stored reconciliation difference is zero.",
    };
  } else {
    cashStatus = {
      id: "cash_status",
      label: "Cash Status",
      display_value: "Difference",
      availability: "available",
      detail: `Stored difference ${formatMoney(cash.difference)}.`,
    };
  }

  return [dailyRevenue, dailyProfit, cashStatus];
}

/**
 * Compose the complete Dashboard view from a Dashboard Read Model.
 */
export function buildDashboardCompletion(
  readModel: DashboardReadModel,
): { data: DashboardCompletionModel | null; error: string | null } {
  const kpi = buildDashboardKpiCardsFromReadModel(readModel);
  if (kpi.error || !kpi.data) {
    return { data: null, error: kpi.error ?? "Failed to build KPI cards" };
  }

  const operational = buildOperationalDashboardFromReadModel(readModel);
  if (operational.error || !operational.data) {
    return {
      data: null,
      error: operational.error ?? "Failed to build operational dashboard",
    };
  }

  const health = buildBusinessHealthFromReadModel(readModel);
  if (health.error || !health.data) {
    return {
      data: null,
      error: health.error ?? "Failed to build business health",
    };
  }

  return {
    data: {
      read_model: readModel,
      kpi_cards: kpi.data.cards,
      operational: operational.data,
      business_health: health.data,
      daily_snapshot: {
        fields: buildDailySnapshotFields(readModel),
      },
      low_stock_alerts: readModel.low_stock_alerts,
      informational_messages: dedupeInformationalMessages(
        buildInformationalMessages(readModel),
      ),
    },
    error: null,
  };
}

/**
 * Assert identical read-model inputs produce an identical completion view.
 */
export function assertDashboardCompletionHistoricallyConsistent(input: {
  previous: DashboardCompletionModel;
  next: DashboardCompletionModel;
}): string | null {
  const { previous, next } = input;

  if (
    previous.kpi_cards.length !== next.kpi_cards.length ||
    previous.operational.shift_context !== next.operational.shift_context ||
    previous.business_health.overall_level !==
      next.business_health.overall_level ||
    previous.informational_messages.join("|") !==
      next.informational_messages.join("|") ||
    JSON.stringify(previous.daily_snapshot) !==
      JSON.stringify(next.daily_snapshot) ||
    JSON.stringify(previous.low_stock_alerts) !==
      JSON.stringify(next.low_stock_alerts) ||
    previous.read_model.current_shift?.id !==
      next.read_model.current_shift?.id ||
    previous.read_model.latest_closed_shift?.id !==
      next.read_model.latest_closed_shift?.id ||
    previous.read_model.daily_sales_summary?.id !==
      next.read_model.daily_sales_summary?.id ||
    previous.read_model.daily_profit_summary?.id !==
      next.read_model.daily_profit_summary?.id ||
    previous.read_model.cash_reconciliation?.id !==
      next.read_model.cash_reconciliation?.id
  ) {
    return "Dashboard completion is inconsistent for the same read model.";
  }

  return null;
}
