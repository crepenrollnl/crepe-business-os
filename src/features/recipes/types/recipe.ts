/**
 * Recipes domain contracts.
 * Cost and allergen rollups must be derived in services, never hardcoded in UI.
 */

export interface Recipe {
  id: string;
  name: string;
  product_id: string | null;
  yield_quantity: number;
  yield_unit: string;
  notes: string | null;
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

export interface RecipeCostSummary {
  recipe_id: string;
  total_cost: number;
  cost_per_yield_unit: number;
  allergen_codes: string[];
}
