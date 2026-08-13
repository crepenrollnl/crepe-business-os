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

/**
 * A recipe is either a pre-produced sub-component (dough, filling, sauce)
 * or an assembly sold to the customer and built from components at sale
 * time. See docs/BATCH_CONSUMPTION.md / Critical Finding #4.
 */
export const RECIPE_ROLES = ["component", "assembly"] as const;
export type RecipeRole = (typeof RECIPE_ROLES)[number];
export const DEFAULT_RECIPE_ROLE: RecipeRole = "assembly";

export function isRecipeRole(value: string): value is RecipeRole {
  return (RECIPE_ROLES as readonly string[]).includes(value);
}

export interface Recipe {
  id: string;
  name: string;
  description: string | null;
  yield_quantity: number;
  yield_unit: string;
  is_active: boolean;
  recipe_role: RecipeRole;
  /** Optional list price. Null when not set yet — see sql/086_quick_sale.sql. */
  selling_price: number | null;
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

/** A recipe eligible to be picked as a component in an assembly's BOM. */
export interface ComponentRecipeOption {
  id: string;
  name: string;
  yield_unit: string;
}

/** recipe_components has no id column of its own — composite PK. */
export interface RecipeComponent {
  assembly_recipe_id: string;
  component_recipe_id: string;
  quantity: number;
  unit: string;
}

export interface RecipeComponentWithRelations extends RecipeComponent {
  component: ComponentRecipeOption | null;
}

export interface RecipeWithRelations extends Recipe {
  items: RecipeItemWithRelations[];
  components: RecipeComponentWithRelations[];
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

export interface RecipeComponentLineInput {
  component_recipe_id: string;
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
  recipe_role: RecipeRole;
  /** Optional. null means empty/unset, not zero. */
  selling_price: number | null;
  /** Used when recipe_role = 'component'. */
  lines: RecipeLineInput[];
  /** Used when recipe_role = 'assembly'. */
  components: RecipeComponentLineInput[];
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
