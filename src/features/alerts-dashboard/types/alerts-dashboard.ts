/**
 * Alerts Dashboard domain contracts (DEV-069).
 *
 * Read path: get_alerts_dashboard RPC over alerts_dashboard.
 * Values come from SQL - never recalculated in TypeScript.
 */

/**
 * Mapped row from get_alerts_dashboard for service consumers.
 */
export interface AlertsDashboard {
  low_stock_alerts: number;
  out_of_stock_alerts: number;
  overdue_production: number;
  failed_batches: number;
  stale_purchase_prices: number;
  inactive_suppliers: number;
  declining_sales: boolean;
  missing_company_settings: boolean;
  backup_status: string;
  import_export_failures: number;
}

export type { ServiceResult } from "@/types/service";
