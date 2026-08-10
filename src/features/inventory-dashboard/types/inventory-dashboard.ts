/**
 * Inventory Dashboard domain contracts (DEV-064).
 *
 * Read path: get_inventory_dashboard RPC over inventory_dashboard.
 * Values come from SQL - never recalculated in TypeScript.
 */

/**
 * Mapped row from get_inventory_dashboard for service consumers.
 */
export interface InventoryDashboard {
  total_ingredients: number;
  low_stock_count: number;
  out_of_stock_count: number;
  total_inventory_value: number;
  last_purchase_date: string | null;
  last_production_date: string | null;
}

export type { ServiceResult } from "@/types/service";
