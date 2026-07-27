/**
 * Daily Sales Summary contracts (DEV-114).
 *
 * Frozen commercial snapshot for a closed Shift.
 * Generated once at close; never recalculated.
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

/**
 * Completed-sale facts used by the pure builder.
 * Net = subtotal (ex-VAT). Gross = total (inc-VAT).
 */
export interface DailySalesSaleFact {
  id: string;
  status: "confirmed" | "paid";
  subtotal: number;
  total: number;
  items_sold: number;
}

export interface BuildDailySalesSummaryInput {
  shift_id: string;
  sales: DailySalesSaleFact[];
  /**
   * Optional set of shift ids that already have a frozen summary
   * (duplicate generation guard).
   */
  existing_shift_ids?: ReadonlySet<string> | readonly string[];
}

export interface BuildDailySalesSummaryResult {
  shift_id: string;
  sales_count: number;
  items_sold: number;
  gross_revenue: number;
  net_revenue: number;
  average_receipt: number;
  is_frozen: true;
}

export interface GenerateDailySalesSummaryResult {
  summary: DailySalesSummary;
}
