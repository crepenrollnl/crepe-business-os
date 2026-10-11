/**
 * Daily Profit Summary contracts (DEV-115).
 *
 * Frozen profit snapshot for a closed Shift.
 * Written once by close_shift (sql/142) in the same transaction that
 * closes the shift, with the formulas of verify_daily_profit_summary
 * (sql/092). Never recalculated after insert.
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
