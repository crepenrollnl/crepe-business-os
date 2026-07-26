/**
 * Customer Sales Analytics domain contracts (DEV-061).
 *
 * Read path: get_customer_sales_analytics /
 * get_customer_sales_analytics_by_customer RPCs over customer_sales_analytics.
 * Values come from SQL - never recalculated in TypeScript.
 */

/**
 * Mapped row from customer_sales_analytics for service consumers.
 */
export interface CustomerSalesAnalytics {
  customer_id: string;
  customer_name: string;
  sale_count: number;
  total_revenue: number;
  average_sale_value: number;
  last_sale_date: string | null;
}

export type { ServiceResult } from "@/types/service";
