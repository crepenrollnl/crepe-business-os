import type { Quantity } from "@/types/erp";

import type { PlanningResult } from "../domain/planning-result";
import type { PlanValidationIssue } from "../types/validation";
import type {
  ShoppingList,
  ShoppingListItem,
  ShoppingListSummary,
} from "./types";
import { validatePlanningResultForShoppingList } from "./validate-planning-result-for-shopping-list";

/**
 * Generator output. Business validation never throws.
 */
export type GenerateShoppingListOutput =
  | { ok: true; shoppingList: ShoppingList }
  | { ok: false; issues: readonly PlanValidationIssue[] };

function buildSummary(items: readonly ShoppingListItem[]): ShoppingListSummary {
  let totalMissingQuantity: Quantity = 0;
  for (const item of items) {
    totalMissingQuantity += item.shortageQuantity;
  }

  const totalItems = items.length;

  return {
    totalItems,
    totalMissingQuantity,
    ingredientsToBuy: totalItems,
  };
}

/**
 * Shopping List Generator (DEV-004).
 *
 * Transforms a PlanningResult into a purchasing recommendation.
 *
 * Rules:
 * - Include only ingredients where shortageQuantity > 0
 * - Never include zero or negative shortages
 * - Never modify the Planning Result
 * - Deterministic: same input always yields the same output
 * - Never creates Purchases, drafts, or inventory mutations
 *
 * This is the only approved way to generate shopping lists from
 * Production Planning results.
 */
export function generateShoppingList(
  planningResult: PlanningResult,
): GenerateShoppingListOutput {
  const validation = validatePlanningResultForShoppingList(planningResult);

  if (!validation.ok) {
    return { ok: false, issues: validation.issues };
  }

  const items: ShoppingListItem[] = [];

  for (const requirement of planningResult.ingredientRequirements) {
    if (requirement.shortageQuantity > 0) {
      items.push({
        ingredientId: requirement.ingredientId,
        ingredientName: requirement.ingredientName,
        unit: requirement.unit,
        shortageQuantity: requirement.shortageQuantity,
        currentStock: requirement.availableQuantity,
        requiredQuantity: requirement.requiredQuantity,
      });
    }
  }

  const shoppingList: ShoppingList = {
    items,
    summary: buildSummary(items),
  };

  return { ok: true, shoppingList };
}
