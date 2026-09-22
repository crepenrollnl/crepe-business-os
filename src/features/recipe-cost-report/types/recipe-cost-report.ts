/**
 * Recipe cost report payload from get_recipe_cost_report /
 * get_recipe_cost_detail (sql/122). Field names match the SQL JSON.
 * Never recalculated in TypeScript.
 */

export const RECIPE_COST_ROLES = ["component", "assembly"] as const;
export type RecipeCostRole = (typeof RECIPE_COST_ROLES)[number];

export interface RecipeCostMissingIngredient {
  ingredient_id: string;
  ingredient_name: string;
  unit: string;
}

export interface RecipeCostIngredientBreakdown {
  ingredient_id: string;
  ingredient_name: string;
  quantity: number;
  unit: string;
  cost_per_unit: number | null;
  line_cost: number;
}

export interface RecipeCostReportRow {
  recipe_id: string;
  recipe_name: string;
  recipe_role: RecipeCostRole;
  yield_quantity: number;
  yield_unit: string;
  is_active: boolean;
  selling_price: number | null;
  total_cost: number | null;
  cost_per_yield_unit: number | null;
  has_missing_cost_data: boolean | null;
  missing_ingredients: RecipeCostMissingIngredient[] | null;
  calculation_error: string | null;
}

export interface RecipeCostDetail extends RecipeCostReportRow {
  ingredient_breakdown: RecipeCostIngredientBreakdown[];
}
