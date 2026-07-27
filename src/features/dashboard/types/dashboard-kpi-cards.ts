/**
 * Dashboard KPI Cards contracts (DEV-123).
 *
 * Display-only cards projected from Dashboard Read Model (DEV-122).
 * No business recalculation — values are copied or selected from existing facts.
 */

export const DASHBOARD_KPI_CARD_IDS = [
  "gross_revenue",
  "gross_profit",
  "active_shift_status",
  "critical_inventory_alerts",
] as const;

export type DashboardKpiCardId = (typeof DASHBOARD_KPI_CARD_IDS)[number];

export const DASHBOARD_KPI_CARD_AVAILABILITIES = [
  "available",
  "empty",
  "missing",
] as const;

export type DashboardKpiCardAvailability =
  (typeof DASHBOARD_KPI_CARD_AVAILABILITIES)[number];

/**
 * One display-ready KPI card.
 * React renders display_value as-is — no formatting or math in the UI.
 */
export interface DashboardKpiCard {
  id: DashboardKpiCardId;
  title: string;
  /** Pre-formatted primary value for the card surface. */
  display_value: string;
  /** Raw numeric when applicable; null for status / missing. */
  numeric_value: number | null;
  availability: DashboardKpiCardAvailability;
  /** Short informational subtitle (never invented metrics). */
  detail: string | null;
}

export interface DashboardKpiCardsModel {
  cards: DashboardKpiCard[];
}

export interface BuildDashboardKpiCardsInput {
  current_shift: {
    id: string;
    status: string;
    opened_at: string;
  } | null;
  daily_sales_summary: {
    gross_revenue: number;
  } | null;
  daily_profit_summary: {
    gross_profit: number;
  } | null;
  /**
   * null = alerts module unavailable.
   * [] = loaded, no alerts.
   */
  low_stock_alerts: ReadonlyArray<{
    alert_level: "critical" | "low";
  }> | null;
}
