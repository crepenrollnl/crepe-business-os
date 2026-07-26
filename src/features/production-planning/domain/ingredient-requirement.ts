import type { EntityId, Quantity, Unit } from "@/types/erp";

/**
 * Aggregated ingredient need for a calculated plan.
 *
 * `shortageQuantity` is derived: max(0, required − available).
 * Availability is read-only context — Planning never deducts stock.
 * `ingredientName` is display metadata carried from inventory context
 * (falls back to ingredient id when a name was not supplied).
 */
export interface IngredientRequirement {
  ingredientId: EntityId;
  ingredientName: string;
  requiredQuantity: Quantity;
  availableQuantity: Quantity;
  shortageQuantity: Quantity;
  unit: Unit;
}
