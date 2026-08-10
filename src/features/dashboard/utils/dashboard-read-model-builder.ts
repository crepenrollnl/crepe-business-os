/**
 * Dashboard Read Model pure builder (DEV-122).
 *
 * Composes existing immutable service facts only.
 * No recalculation of sales, profit, cash, or alerts.
 */

import type {
  BuildDashboardReadModelInput,
  DashboardReadModel,
} from "../types/dashboard-read-model";

function emptyReadModel(): DashboardReadModel {
  return {
    current_shift: null,
    latest_closed_shift: null,
    daily_sales_summary: null,
    daily_profit_summary: null,
    cash_reconciliation: null,
    low_stock_alerts: null,
    kpi_summary: null,
  };
}

/**
 * When an open shift is present, closed-shift review slices stay null.
 * When no open shift, latest closed shift may carry stored summaries.
 */
export function buildDashboardReadModel(
  input: BuildDashboardReadModelInput,
): { data: DashboardReadModel; error: string | null } {
  if (input.current_shift && input.latest_closed_shift) {
    return {
      data: emptyReadModel(),
      error:
        "Dashboard cannot include both an open shift and a closed-shift review context.",
    };
  }

  if (input.current_shift) {
    return {
      data: {
        current_shift: input.current_shift,
        latest_closed_shift: null,
        daily_sales_summary: null,
        daily_profit_summary: null,
        cash_reconciliation: null,
        low_stock_alerts: input.low_stock_alerts,
        kpi_summary: input.kpi_summary,
      },
      error: null,
    };
  }

  return {
    data: {
      current_shift: null,
      latest_closed_shift: input.latest_closed_shift,
      daily_sales_summary: input.daily_sales_summary,
      daily_profit_summary: input.daily_profit_summary,
      cash_reconciliation: input.cash_reconciliation,
      low_stock_alerts: input.low_stock_alerts,
      kpi_summary: input.kpi_summary,
    },
    error: null,
  };
}

/**
 * Assert identical composed inputs produce an identical read model.
 */
export function assertDashboardReadModelHistoricallyConsistent(input: {
  previous: DashboardReadModel;
  next: DashboardReadModel;
}): string | null {
  const { previous, next } = input;

  if (
    previous.current_shift?.id !== next.current_shift?.id ||
    previous.current_shift?.status !== next.current_shift?.status ||
    previous.current_shift?.opened_at !== next.current_shift?.opened_at ||
    previous.current_shift?.closed_at !== next.current_shift?.closed_at ||
    previous.latest_closed_shift?.id !== next.latest_closed_shift?.id ||
    previous.latest_closed_shift?.status !== next.latest_closed_shift?.status ||
    previous.daily_sales_summary?.id !== next.daily_sales_summary?.id ||
    previous.daily_sales_summary?.sales_count !==
      next.daily_sales_summary?.sales_count ||
    previous.daily_sales_summary?.net_revenue !==
      next.daily_sales_summary?.net_revenue ||
    previous.daily_profit_summary?.id !== next.daily_profit_summary?.id ||
    previous.daily_profit_summary?.gross_profit !==
      next.daily_profit_summary?.gross_profit ||
    previous.cash_reconciliation?.id !== next.cash_reconciliation?.id ||
    previous.cash_reconciliation?.difference !==
      next.cash_reconciliation?.difference ||
    JSON.stringify(previous.low_stock_alerts) !==
      JSON.stringify(next.low_stock_alerts) ||
    JSON.stringify(previous.kpi_summary) !== JSON.stringify(next.kpi_summary)
  ) {
    return "Dashboard read model is inconsistent for the same service inputs.";
  }

  return null;
}
