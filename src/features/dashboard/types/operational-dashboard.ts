/**
 * Operational Dashboard contracts (DEV-124).
 *
 * Display-only operational section projected from Dashboard Read Model (DEV-122).
 * No business recalculation — values are copied or selected from existing facts.
 */

export const OPERATIONAL_DASHBOARD_FIELD_IDS = [
  "current_shift_status",
  "shift_opened_at",
  "sales_today",
  "net_revenue_today",
  "gross_profit_today",
  "cash_reconciliation_status",
  "critical_inventory_alerts",
] as const;

export type OperationalDashboardFieldId =
  (typeof OPERATIONAL_DASHBOARD_FIELD_IDS)[number];

export const OPERATIONAL_FIELD_AVAILABILITIES = [
  "available",
  "empty",
  "missing",
  "not_applicable",
] as const;

export type OperationalFieldAvailability =
  (typeof OPERATIONAL_FIELD_AVAILABILITIES)[number];

export type OperationalShiftContext = "none" | "open" | "closed";

/**
 * One display-ready operational field.
 * React renders display_value as-is — no formatting or math in the UI.
 */
export interface OperationalDashboardField {
  id: OperationalDashboardFieldId;
  label: string;
  display_value: string;
  numeric_value: number | null;
  availability: OperationalFieldAvailability;
  detail: string | null;
}

export interface OperationalDashboardModel {
  shift_context: OperationalShiftContext;
  fields: OperationalDashboardField[];
}

export interface BuildOperationalDashboardInput {
  current_shift: {
    id: string;
    status: string;
    opened_at: string;
  } | null;
  latest_closed_shift: {
    id: string;
    status: string;
    opened_at: string;
    closed_at: string | null;
  } | null;
  daily_sales_summary: {
    sales_count: number;
    net_revenue: number;
  } | null;
  daily_profit_summary: {
    gross_profit: number;
  } | null;
  cash_reconciliation: {
    difference: number;
  } | null;
  /**
   * null = alerts module unavailable.
   * [] = loaded, no alerts.
   */
  low_stock_alerts: ReadonlyArray<{
    alert_level: "critical" | "low";
  }> | null;
}
