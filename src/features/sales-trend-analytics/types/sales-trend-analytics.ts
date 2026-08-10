/**
 * Sales Trend Analytics domain contracts (DEV-063).
 *
 * Read path: get_sales_trends / get_sales_trend_summary RPCs over
 * sales_trend_analytics (and overall confirmed/paid sales for summary).
 * Values come from SQL - never recalculated in TypeScript.
 */

export type SalesTrendPeriodType = "daily" | "weekly" | "monthly";

/**
 * Mapped row from sales_trend_analytics for service consumers.
 */
export interface SalesTrendAnalytics {
  period_start: string;
  period_type: SalesTrendPeriodType;
  sale_count: number;
  total_revenue: number;
  average_sale_value: number;
}

/**
 * Mapped overall summary from get_sales_trend_summary.
 */
export interface SalesTrendSummary {
  sale_count: number;
  total_revenue: number;
  average_sale_value: number;
  first_sale_at: string | null;
  last_sale_at: string | null;
}

export type { ServiceResult } from "@/types/service";
