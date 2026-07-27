/**
 * Sales profit contracts (DEV-110).
 *
 * Frozen sale profit from stored net revenue (ex-VAT) and frozen COGS (DEV-108).
 * Never recalculates VAT or COGS. Does not post Accounting or change Reports.
 */

/**
 * Immutable profit summary for a completed sale.
 * Generated from frozen commercial + COGS facts only.
 */
export interface SaleProfitSummary {
  sale_id: string;
  /** Stored sale.subtotal — revenue excluding VAT. */
  net_revenue: number;
  /** Frozen COGS from Finished Goods consumptions. */
  cogs: number;
  /** net_revenue − cogs. */
  gross_profit: number;
  /**
   * (gross_profit / net_revenue) × 100 when net_revenue > 0.
   * null when net_revenue is zero (undefined margin).
   */
  gross_margin_percent: number | null;
  /** True — valuation is frozen from completed-sale facts. */
  is_frozen: true;
}

/** Input facts for the pure profit builder. */
export interface SaleProfitBuilderInput {
  sale_id: string;
  sale_status: "draft" | "confirmed" | "paid" | "cancelled";
  /** Frozen net revenue (ex-VAT). */
  net_revenue: number;
  /** Frozen COGS total. */
  cogs: number;
  /**
   * Optional set of sale ids that already have a built frozen profit summary
   * (duplicate generation guard).
   */
  alreadyBuiltSaleIds?: readonly string[];
}
