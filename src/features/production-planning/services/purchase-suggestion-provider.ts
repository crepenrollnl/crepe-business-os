import type { EntityId, Quantity, Unit } from "@/types/erp";

import type { IngredientRequirement } from "../domain/ingredient-requirement";

/**
 * Suggested purchase line derived from planning shortages.
 * A suggestion is not a Purchase document.
 */
export interface PurchaseSuggestion {
  ingredientId: EntityId;
  suggestedQuantity: Quantity;
  unit: Unit;
}

/**
 * Builds purchase suggestions from ingredient shortages.
 *
 * Suggestions only — must never create Purchase documents or mutate stock.
 * Purchases remain a separate module action under user/service control.
 *
 * Interface only — no database in this package.
 */
export interface PurchaseSuggestionProvider {
  suggest(
    requirements: readonly IngredientRequirement[],
  ): readonly PurchaseSuggestion[];
}
