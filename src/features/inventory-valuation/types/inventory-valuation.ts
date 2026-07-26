/**
 * Inventory Valuation domain contracts (DEV-058).
 *
 * Read path: get_inventory_valuation / get_inventory_item_value RPCs over
 * inventory_valuation. Values come from SQL - never recalculated in TypeScript.
 */

/**
 * Mapped row from inventory_valuation for service consumers.
 */
export interface InventoryValuation {
  ingredient_id: string;
  ingredient_name: string;
  current_quantity: number;
  unit: string;
  average_cost: number;
  stock_value: number;
  last_purchase_date: string | null;
}

export type { ServiceResult } from "@/types/service";
