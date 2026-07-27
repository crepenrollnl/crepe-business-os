/**
 * Daily Profit Summary contracts (DEV-115).
 *
 * Frozen profit snapshot for a closed Shift.
 * Aggregates frozen Sale Profit summaries (DEV-110). Never recalculated.
 */

export interface DailyProfitSummary {
  id: string;
  shift_id: string;
  net_revenue: number;
  total_cogs: number;
  gross_profit: number;
  /**
   * (gross_profit / net_revenue) × 100 when net_revenue > 0.
   * null when net_revenue is zero.
   */
  gross_margin_percent: number | null;
  generated_at: string;
  created_at: string;
}

/**
 * Frozen sale-profit facts used by the pure daily builder.
 */
export interface DailyProfitSaleFact {
  sale_id: string;
  net_revenue: number;
  cogs: number;
  gross_profit: number;
}

export interface BuildDailyProfitSummaryInput {
  shift_id: string;
  sale_profits: DailyProfitSaleFact[];
  /**
   * Optional set of shift ids that already have a frozen profit summary
   * (duplicate generation guard).
   */
  existing_shift_ids?: ReadonlySet<string> | readonly string[];
}

export interface BuildDailyProfitSummaryResult {
  shift_id: string;
  net_revenue: number;
  total_cogs: number;
  gross_profit: number;
  gross_margin_percent: number | null;
  is_frozen: true;
}

export interface GenerateDailyProfitSummaryResult {
  summary: DailyProfitSummary;
}
