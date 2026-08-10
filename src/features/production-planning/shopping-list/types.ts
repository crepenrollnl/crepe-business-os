import type { EntityId, Money, Quantity, Unit } from "@/types/erp";

/**
 * One purchasing recommendation line derived from a planning shortage.
 * Never created for zero or negative shortages.
 */
export interface ShoppingListItem {
  ingredientId: EntityId;
  ingredientName: string;
  unit: Unit;
  shortageQuantity: Quantity;
  /** Current available stock from the planning result (`availableQuantity`). */
  currentStock: Quantity;
  requiredQuantity: Quantity;
  /** Future: preferred supplier for this ingredient. */
  preferredSupplierId?: EntityId;
  /** Future: estimated purchase price for the shortage quantity. */
  estimatedPrice?: Money;
}

/**
 * Aggregate counters for a generated shopping list.
 */
export interface ShoppingListSummary {
  /** Number of shopping list line items. */
  totalItems: number;
  /** Sum of shortage quantities across items. */
  totalMissingQuantity: Quantity;
  /** Number of distinct ingredients to purchase (equals totalItems). */
  ingredientsToBuy: number;
}

/**
 * Purchasing recommendation produced from a PlanningResult.
 * Pure value object — no persistence or Purchase creation implied.
 */
export interface ShoppingList {
  items: readonly ShoppingListItem[];
  summary: ShoppingListSummary;
}
