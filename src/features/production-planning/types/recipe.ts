import type { ActivationStatus, EntityId, Quantity, Unit } from "@/types/erp";
import type { RecipeRole } from "@/features/recipes/types/recipe";

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
  /**
   * Production Planning only plans `component` recipes. Used to decide
   * whether `recipe_components` may be exploded into raw ingredients
   * (Component-in-Component / sql/101). Defaults to `component` when
   * omitted so existing calculator fixtures keep working.
   */
  recipeRole?: RecipeRole;
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
 * One `recipe_components` row, flattened for the calculator.
 * Exactly one of `componentRecipeId` / `ingredientId` is set.
 */
export interface PlanningRecipeComponentLine {
  parentRecipeId: EntityId;
  componentRecipeId: EntityId | null;
  ingredientId: EntityId | null;
  quantityPerYield: Quantity;
  unit: Unit;
}

/**
 * Resolved recipe bill of materials for requirement calculation.
 */
export interface ResolvedRecipeBom {
  recipe: PlanningRecipe;
  ingredients: readonly PlanningRecipeIngredient[];
}
