import type { Quantity } from "@/types/erp";

import type { ProductionPlanStatus } from "../types/status";
import type { IngredientRequirement } from "./ingredient-requirement";
import type { ProductionPlan } from "./production-plan";
import type { ProductionPlanLine } from "./production-plan-line";

/**
 * Aggregate counters and sufficiency flags for a calculated plan.
 * Counts use plain numbers; measurable amounts use Quantity.
 */
export interface PlanningSummary {
  /** Number of products (plan lines). */
  lineCount: number;
  /** Number of distinct aggregated ingredients. */
  ingredientCount: number;
  /** Ingredients with zero shortage. */
  availableIngredientCount: number;
  /** Ingredients with shortage > 0 (ingredients missing). */
  shortageLineCount: number;
  /** Sum of planned finished-good quantities. */
  totalPlannedQuantity: Quantity;
  /** Sum of required ingredient quantities. */
  totalRequiredQuantity: Quantity;
  /** Sum of missing ingredient quantities. */
  totalShortageQuantity: Quantity;
  hasShortages: boolean;
  isInventorySufficient: boolean;
  /**
   * Derived planning status after calculation.
   * `ready_for_purchase` when shortages exist; otherwise `ready_for_production`.
   */
  status: ProductionPlanStatus;
}

/**
 * Full output of a planning calculation.
 * Pure result object — no persistence or side effects implied.
 */
export interface PlanningResult {
  plan: ProductionPlan;
  lines: readonly ProductionPlanLine[];
  ingredientRequirements: readonly IngredientRequirement[];
  summary: PlanningSummary;
}
