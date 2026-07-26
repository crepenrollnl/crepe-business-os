import type { ActivationStatus, EntityId, Quantity, Unit } from "@/types/erp";

/**
 * Read-only recipe snapshot used by Planning.
 * Planning never mutates recipes.
 */
export interface PlanningRecipe {
  id: EntityId;
  finishedGoodId: EntityId;
  /** Master-data activation; archived recipes cannot be planned. */
  status: ActivationStatus;
  yieldQuantity: Quantity;
  yieldUnit: Unit;
}

/**
 * One BOM line on a planning recipe (ingredient need per yield).
 */
export interface PlanningRecipeIngredient {
  ingredientId: EntityId;
  quantityPerYield: Quantity;
  unit: Unit;
}

/**
 * Recipe ingredient row with owning recipe id.
 * Used as a flat calculator input before BOM resolution.
 */
export interface PlanningRecipeIngredientLine extends PlanningRecipeIngredient {
  recipeId: EntityId;
}

/**
 * Resolved recipe bill of materials for requirement calculation.
 */
export interface ResolvedRecipeBom {
  recipe: PlanningRecipe;
  ingredients: readonly PlanningRecipeIngredient[];
}
