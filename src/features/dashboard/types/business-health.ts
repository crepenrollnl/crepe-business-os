/**
 * Business Health contracts (DEV-125).
 *
 * Informational summary composed from Dashboard Read Model statuses only.
 * No financial or inventory recalculation.
 */

export const BUSINESS_HEALTH_LEVELS = [
  "healthy",
  "attention",
  "critical",
] as const;

export type BusinessHealthLevel = (typeof BUSINESS_HEALTH_LEVELS)[number];

export const BUSINESS_HEALTH_INDICATOR_IDS = [
  "shift_status",
  "cash_status",
  "inventory_status",
  "alert_count",
] as const;

export type BusinessHealthIndicatorId =
  (typeof BUSINESS_HEALTH_INDICATOR_IDS)[number];

/**
 * One display-ready health indicator.
 * React renders display_value as-is.
 */
export interface BusinessHealthIndicator {
  id: BusinessHealthIndicatorId;
  label: string;
  display_value: string;
  /** Indicator-level health contribution when applicable. */
  level: BusinessHealthLevel | null;
  detail: string | null;
}

export interface BusinessHealthModel {
  overall_level: BusinessHealthLevel;
  overall_display: string;
  overall_detail: string;
  indicators: BusinessHealthIndicator[];
}

export interface BuildBusinessHealthInput {
  current_shift: { id: string; status: string } | null;
  latest_closed_shift: { id: string; status: string } | null;
  cash_reconciliation: { difference: number } | null;
  /**
   * null = alerts module unavailable.
   * [] = loaded, no alerts.
   */
  low_stock_alerts: ReadonlyArray<{
    alert_level: "critical" | "low";
  }> | null;
}
