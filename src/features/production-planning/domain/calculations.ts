import type { Quantity } from "@/types/erp";

import type { ProductionPlanStatus } from "../types/status";
import type { IngredientRequirement } from "./ingredient-requirement";
import type { ProductionPlanLine } from "./production-plan-line";
import type { PlanningSummary } from "./planning-result";

/**
 * Shortage is never negative. Planning never mutates available stock.
 */
export function computeShortageQuantity(
  requiredQuantity: Quantity,
  availableQuantity: Quantity,
): Quantity {
  const shortage = requiredQuantity - availableQuantity;
  return shortage > 0 ? shortage : 0;
}

/**
 * Derive lifecycle status from shortage presence.
 * Draft → Calculated → ReadyForPurchase | ReadyForProduction.
 * Final status is never assigned manually.
 */
export function derivePlanningStatus(
  hasShortages: boolean,
): Extract<
  ProductionPlanStatus,
  "ready_for_purchase" | "ready_for_production"
> {
  return hasShortages ? "ready_for_purchase" : "ready_for_production";
}

/**
 * Build summary aggregates from lines and ingredient requirements.
 */
export function buildPlanningSummary(
  lines: readonly ProductionPlanLine[],
  ingredientRequirements: readonly IngredientRequirement[],
): PlanningSummary {
  let totalPlannedQuantity: Quantity = 0;
  for (const line of lines) {
    totalPlannedQuantity += line.plannedQuantity;
  }

  let shortageLineCount = 0;
  let availableIngredientCount = 0;
  let totalRequiredQuantity: Quantity = 0;
  let totalShortageQuantity: Quantity = 0;

  for (const requirement of ingredientRequirements) {
    totalRequiredQuantity += requirement.requiredQuantity;
    if (requirement.shortageQuantity > 0) {
      shortageLineCount += 1;
      totalShortageQuantity += requirement.shortageQuantity;
    } else {
      availableIngredientCount += 1;
    }
  }

  const hasShortages = shortageLineCount > 0;
  const status = derivePlanningStatus(hasShortages);

  return {
    lineCount: lines.length,
    ingredientCount: ingredientRequirements.length,
    availableIngredientCount,
    shortageLineCount,
    totalPlannedQuantity,
    totalRequiredQuantity,
    totalShortageQuantity,
    hasShortages,
    isInventorySufficient: !hasShortages,
    status,
  };
}
