/**
 * Supplier Performance domain contracts (DEV-060).
 *
 * Read path: get_supplier_performance /
 * get_supplier_performance_by_supplier RPCs over supplier_performance.
 * Values come from SQL - never recalculated in TypeScript.
 */

/**
 * Mapped row from supplier_performance for service consumers.
 */
export interface SupplierPerformance {
  supplier_id: string;
  supplier_name: string;
  purchase_count: number;
  total_spent: number;
  average_order_value: number;
  last_purchase_date: string | null;
}

export type { ServiceResult } from "@/types/service";
