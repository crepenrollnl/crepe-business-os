/**
 * Recipes domain contracts.
 * Recipes define bill-of-materials only. Stock is not changed here.
 * Cost and allergen rollups will be derived in services later.
 */

import {
  DEFAULT_YIELD_UNIT,
  YIELD_UNITS,
  isYieldUnit,
  type YieldUnit,
} from "@/constants/units";

/** @deprecated Prefer `YIELD_UNITS` from `@/constants/units`. */
export const RECIPE_YIELD_UNITS = YIELD_UNITS;

export type RecipeYieldUnit = YieldUnit;

/** @deprecated Prefer `DEFAULT_YIELD_UNIT` from `@/constants/units`. */
export const DEFAULT_RECIPE_YIELD_UNIT: RecipeYieldUnit = DEFAULT_YIELD_UNIT;

export function isRecipeYieldUnit(value: string): value is RecipeYieldUnit {
  return isYieldUnit(value);
}

export interface RecipeIngredientOption {
  id: string;
  name: string;
  unit: string;
}

export interface Recipe {
  id: string;
  name: string;
  description: string | null;
  yield_quantity: number;
  yield_unit: string;
  is_active: boolean;
  created_at: string;
  updated_at?: string;
}

export interface RecipeItem {
  id: string;
  recipe_id: string;
  ingredient_id: string;
  quantity: number;
  unit: string;
}

export interface RecipeItemWithRelations extends RecipeItem {
  ingredient: RecipeIngredientOption | null;
}

export interface RecipeWithRelations extends Recipe {
  items: RecipeItemWithRelations[];
}

export interface RecipeListItem extends Recipe {
  item_count: number;
}

export interface RecipeLineInput {
  ingredient_id: string;
  /** null means the field is empty in the form (not submitted until filled). */
  quantity: number | null;
  unit: string;
}

export interface RecipeFormValues {
  name: string;
  description: string;
  /** null means the field is empty in the form (not submitted until filled). */
  yield_quantity: number | null;
  yield_unit: RecipeYieldUnit;
  is_active: boolean;
  lines: RecipeLineInput[];
}

export interface SaveRecipeInput extends RecipeFormValues {
  id?: string;
}

export interface RecipeCostSummary {
  recipe_id: string;
  total_cost: number;
  cost_per_yield_unit: number;
  allergen_codes: string[];
}

export type RecipeSortField = "name" | "yield_quantity" | "item_count";
export type RecipeSortDirection = "asc" | "desc";

export type { ServiceResult } from "@/types/service";
