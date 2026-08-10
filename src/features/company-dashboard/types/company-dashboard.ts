/**
 * Company Dashboard domain contracts (DEV-066).
 *
 * Read path: get_company_dashboard RPC over company_dashboard.
 * Values come from SQL - never recalculated in TypeScript.
 */

/**
 * Mapped row from get_company_dashboard for service consumers.
 */
export interface CompanyDashboard {
  total_suppliers: number;
  total_customers: number;
  total_recipes: number;
  total_ingredients: number;
  total_finished_goods: number;
  total_sales: number;
  total_purchases: number;
  total_production_batches: number;
  last_sale_date: string | null;
  last_purchase_date: string | null;
  last_production_date: string | null;
}

export type { ServiceResult } from "@/types/service";
