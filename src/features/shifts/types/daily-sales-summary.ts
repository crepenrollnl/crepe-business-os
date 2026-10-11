/**
 * Daily Sales Summary contracts (DEV-114).
 *
 * Frozen commercial snapshot for a closed Shift.
 * Written once by close_shift (sql/142) in the same transaction that
 * closes the shift; never recalculated.
 */

export interface DailySalesSummary {
  id: string;
  shift_id: string;
  sales_count: number;
  items_sold: number;
  gross_revenue: number;
  net_revenue: number;
  average_receipt: number;
  generated_at: string;
  created_at: string;
}
