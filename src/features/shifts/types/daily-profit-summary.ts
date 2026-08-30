/**
 * Daily Profit Summary contracts (DEV-115).
 *
 * Frozen profit snapshot for a closed Shift.
 * Shift totals are ledger-window aggregates (raw layer COGS + sale
 * subtotals), rounded once — same order as verify_daily_profit_summary
 * (sql/092). Per-sale profit (DEV-110) is a completeness gate only.
 * Never recalculated after insert.
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
 * One completed sale's unrounded contribution to the shift aggregate.
 * `net_revenue` is sales.subtotal; `cogs` is the raw sum of FG
 * total_cost + ingredient quantity × unit_cost. The builder rounds
 * after summing every sale — not per fact.
 */
export interface DailyProfitSaleFact {
  sale_id: string;
  net_revenue: number;
  cogs: number;
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
