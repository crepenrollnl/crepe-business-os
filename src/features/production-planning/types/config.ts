import { QUANTITY_DECIMAL_PLACES } from "@/constants/config";

/**
 * Configuration for the Production Planning calculation engine.
 * Pure options only — no environment secrets or I/O.
 */
export interface PlanningCalculationConfig {
  /** Decimal places for quantity rounding during scaling and aggregation. */
  quantityDecimalPlaces: number;
}

export const DEFAULT_PLANNING_CALCULATION_CONFIG: PlanningCalculationConfig = {
  quantityDecimalPlaces: QUANTITY_DECIMAL_PLACES,
};

/**
 * Merge caller overrides with defaults. Never mutates `overrides`.
 */
export function resolvePlanningCalculationConfig(
  overrides?: Partial<PlanningCalculationConfig>,
): PlanningCalculationConfig {
  if (!overrides) {
    return { ...DEFAULT_PLANNING_CALCULATION_CONFIG };
  }

  const quantityDecimalPlaces =
    overrides.quantityDecimalPlaces === undefined
      ? DEFAULT_PLANNING_CALCULATION_CONFIG.quantityDecimalPlaces
      : overrides.quantityDecimalPlaces;

  return {
    quantityDecimalPlaces: Number.isFinite(quantityDecimalPlaces)
      ? Math.max(0, Math.floor(quantityDecimalPlaces))
      : DEFAULT_PLANNING_CALCULATION_CONFIG.quantityDecimalPlaces,
  };
}
