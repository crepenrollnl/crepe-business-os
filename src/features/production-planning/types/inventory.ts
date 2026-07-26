import type { EntityId, Quantity } from "@/types/erp";

/**
 * Read-only inventory availability snapshot for planning.
 * Planning never mutates stock from this input.
 */
export interface PlanningInventoryItem {
  ingredientId: EntityId;
  availableQuantity: Quantity;
  /** Optional display name for shopping-list / UI enrichment. */
  ingredientName?: string;
}
