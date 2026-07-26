/**
 * Recipe Cost Analysis domain contracts (DEV-057).
 *
 * Read path: get_recipe_cost_analysis / get_recipe_cost RPCs over
 * recipe_cost_analysis. Totals come from SQL - never recalculated in TypeScript.
 */

/**
 * Mapped row from recipe_cost_analysis for service consumers.
 */
export interface RecipeCostAnalysis {
  recipe_id: string;
  recipe_name: string;
  total_cost: number;
  ingredient_count: number;
  last_cost_update: string;
  cost_per_portion: number | null;
}

export type { ServiceResult } from "@/types/service";
