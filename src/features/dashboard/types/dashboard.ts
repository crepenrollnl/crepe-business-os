/**
 * Dashboard domain contracts (DEV-042 / DEV-044).
 *
 * Read path: dashboard_summary SQL view.
 * KPI values come from SQL — never recalculated in TypeScript.
 */

/**
 * Single-row DTO from dashboard_summary.
 * DEV-042 fields retained for backward compatibility.
 * DEV-044 operational KPIs appended.
 */
export interface DashboardSummary {
  total_inventory_value: number;
  inventory_items_below_minimum: number;
  finished_goods_available: number;
  total_sales_count: number;
  total_purchase_count: number;
  active_customers_count: number;
  active_suppliers_count: number;

  /** DEV-044 — inventory */
  low_stock_items: number;
  out_of_stock_items: number;

  /** DEV-044 — production */
  batches_in_progress: number;
  finished_batches_today: number;

  /** DEV-044 — sales */
  draft_sales_count: number;
  confirmed_sales_today: number;

  /** DEV-044 — purchases */
  draft_purchase_count: number;
  completed_purchases_today: number;

  /** DEV-044 — activity timestamps (null when no events) */
  last_inventory_movement_at: string | null;
  last_sale_at: string | null;
  last_purchase_at: string | null;
}

export type { ServiceResult } from "@/types/service";
