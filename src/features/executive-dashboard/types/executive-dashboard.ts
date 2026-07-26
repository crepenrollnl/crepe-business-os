/**
 * Executive Dashboard domain contracts (DEV-067).
 *
 * Read path: get_executive_dashboard RPC over executive_dashboard.
 * Values come from SQL - never recalculated in TypeScript.
 */

export type ExecutiveCompanyHealth =
  | "ok"
  | "attention"
  | "critical"
  | "unknown";

/**
 * Mapped row from get_executive_dashboard for service consumers.
 * sales_growth is percent change between the last two monthly periods.
 */
export interface ExecutiveDashboard {
  company_health: ExecutiveCompanyHealth;
  inventory_value: number;
  low_stock_count: number;
  total_sales: number;
  total_purchases: number;
  total_batches: number;
  sales_growth: number | null;
  last_sale_date: string | null;
  last_purchase_date: string | null;
  last_production_date: string | null;
}

export type { ServiceResult } from "@/types/service";
