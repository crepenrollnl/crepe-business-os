/**
 * Purchase Price History domain contracts (DEV-059).
 *
 * Read path: get_purchase_price_history /
 * get_purchase_price_history_by_ingredient RPCs over purchase_price_history.
 * Values come from SQL - never recalculated in TypeScript.
 */

/**
 * Mapped row from purchase_price_history for service consumers.
 */
export interface PurchasePriceHistory {
  ingredient_id: string;
  ingredient_name: string;
  supplier_name: string;
  purchase_date: string;
  quantity: number;
  unit_price: number;
  total_price: number;
}

export type { ServiceResult } from "@/types/service";
