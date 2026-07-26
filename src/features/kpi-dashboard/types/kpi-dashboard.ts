/**
 * KPI Dashboard domain contracts (DEV-068).
 *
 * Read path: get_kpi_dashboard RPC over kpi_dashboard.
 * Values come from SQL - never recalculated in TypeScript.
 */

/**
 * Mapped row from get_kpi_dashboard for service consumers.
 */
export interface KpiDashboard {
  gross_revenue: number;
  total_orders: number;
  average_order_value: number;
  inventory_turnover: number | null;
  recipe_cost_average: number | null;
  supplier_count: number;
  customer_count: number;
  production_efficiency: number | null;
  low_stock_ratio: number | null;
  sales_growth: number | null;
}

export type { ServiceResult } from "@/types/service";
