/**
 * Dashboard Read Model contracts (DEV-122).
 *
 * Composed display-only model from existing immutable services.
 * Builder never recalculates business values.
 */

import type { LowStockAlert } from "@/features/inventory/types/low-stock-alert";
import type { CashReconciliation } from "@/features/shifts/types/cash-reconciliation";
import type { DailyProfitSummary } from "@/features/shifts/types/daily-profit-summary";
import type { DailySalesSummary } from "@/features/shifts/types/daily-sales-summary";
import type { Shift } from "@/features/shifts/types/shift";
import type { DashboardSummary } from "./dashboard";

/**
 * Single composed Dashboard read model.
 * Missing modules are null — never invented.
 */
export interface DashboardReadModel {
  /** Open shift when one exists. */
  current_shift: Shift | null;
  /**
   * Latest closed shift for Close Day Review when no open shift.
   * Null when an open shift exists or no closed history.
   */
  latest_closed_shift: Shift | null;
  daily_sales_summary: DailySalesSummary | null;
  daily_profit_summary: DailyProfitSummary | null;
  cash_reconciliation: CashReconciliation | null;
  /**
   * Low stock alerts from Inventory advisory services.
   * null when the alerts module is unavailable; [] when none.
   */
  low_stock_alerts: LowStockAlert[] | null;
  /**
   * Existing dashboard_summary KPI row.
   * null when the summary view is unavailable.
   */
  kpi_summary: DashboardSummary | null;
}

export interface BuildDashboardReadModelInput {
  current_shift: Shift | null;
  latest_closed_shift: Shift | null;
  daily_sales_summary: DailySalesSummary | null;
  daily_profit_summary: DailyProfitSummary | null;
  cash_reconciliation: CashReconciliation | null;
  low_stock_alerts: LowStockAlert[] | null;
  kpi_summary: DashboardSummary | null;
}
