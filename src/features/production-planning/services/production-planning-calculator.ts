import type {
  CalculateProductionPlanInput,
  CalculateProductionPlanOutput,
} from "../engine/calculate-production-plan";
import { calculateProductionPlan } from "../engine/calculate-production-plan";

export type {
  CalculateProductionPlanInput,
  CalculateProductionPlanOutput,
};

/**
 * Calculates ingredient requirements and planning summary from plan inputs.
 *
 * Allowed: calculate, validate, aggregate.
 * Forbidden: modify inventory, create purchases, create production batches,
 * consume stock.
 *
 * Implementations must be pure: same input → same output, no side effects.
 */
export interface ProductionPlanningCalculator {
  calculate(
    input: CalculateProductionPlanInput,
  ): CalculateProductionPlanOutput;
}

/**
 * Default pure calculator — single source of truth for planning math.
 */
export function createProductionPlanningCalculator(): ProductionPlanningCalculator {
  return {
    calculate: calculateProductionPlan,
  };
}
