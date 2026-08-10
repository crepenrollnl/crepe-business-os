/**
 * Dashboard Completion pure builder (Dashboard redesign — 3 blocks).
 *
 * Composes existing Dashboard Read Model projections into one view model.
 * Never recalculates revenue, profit, cash, or inventory metrics.
 */

import type { DashboardCompletionModel } from "../types/dashboard-completion";
import type { DashboardReadModel } from "../types/dashboard-read-model";
import { buildMoneyTodayFromReadModel } from "./money-today-builder";
import { dedupeInformationalMessages } from "./dashboard-resilience";

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

/**
 * Compose the complete Dashboard view from a Dashboard Read Model.
 */
export function buildDashboardCompletion(
  readModel: DashboardReadModel,
): { data: DashboardCompletionModel | null; error: string | null } {
  const moneyToday = buildMoneyTodayFromReadModel(readModel);
  if (moneyToday.error || !moneyToday.data) {
    return {
      data: null,
      error: moneyToday.error ?? "Failed to build Money Today",
    };
  }

  return {
    data: {
      read_model: readModel,
      money_today: moneyToday.data,
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
    previous.money_today.source !== next.money_today.source ||
    previous.money_today.revenue.display_value !==
      next.money_today.revenue.display_value ||
    previous.money_today.profit.display_value !==
      next.money_today.profit.display_value ||
    previous.informational_messages.join("|") !==
      next.informational_messages.join("|") ||
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
