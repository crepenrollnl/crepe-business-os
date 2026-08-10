/**
 * Inventory Movement History domain contracts (DEV-062).
 *
 * Read path: get_inventory_movement_history /
 * get_inventory_movement_history_by_ingredient RPCs over
 * inventory_movement_history.
 * Values come from SQL - never recalculated in TypeScript.
 */

/**
 * Mapped row from inventory_movement_history for service consumers.
 */
export interface InventoryMovementHistory {
  movement_id: string;
  ingredient_id: string;
  ingredient_name: string;
  movement_type: string;
  quantity: number;
  unit: string;
  source_type: string;
  source_id: string | null;
  occurred_at: string;
}

export type { ServiceResult } from "@/types/service";
