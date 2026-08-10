import type { EntityId } from "@/types/erp";

import type { PlanningInventoryItem } from "../types/inventory";
import type {
  PlanValidationIssue,
  ValidationResult,
} from "../types/validation";
import { validationFail, validationOk } from "../types/validation";

export interface ValidatePlanningInventoryInput {
  inventory: readonly PlanningInventoryItem[];
  /**
   * Ingredient ids required after aggregation.
   * Each must appear exactly once in inventory.
   */
  requiredIngredientIds: readonly EntityId[];
}

function isInvalidQuantity(value: number): boolean {
  return !Number.isFinite(value);
}

/**
 * Validate inventory snapshots used by the planning calculator.
 *
 * Checks:
 * - duplicate inventory items
 * - invalid / negative available quantities
 * - missing inventory for required ingredients
 *
 * Returns a typed ValidationResult. Never throws for validation failures.
 */
export function validatePlanningInventory(
  input: ValidatePlanningInventoryInput,
): ValidationResult {
  const issues: PlanValidationIssue[] = [];
  const { inventory, requiredIngredientIds } = input;

  const byIngredientId = new Map<EntityId, number>();

  for (let index = 0; index < inventory.length; index += 1) {
    const item = inventory[index];
    const fieldPrefix = `inventory[${index}]`;

    const previousIndex = byIngredientId.get(item.ingredientId);
    if (previousIndex !== undefined) {
      issues.push({
        code: "duplicate_inventory",
        message: "Each inventory ingredient may appear at most once.",
        field: `${fieldPrefix}.ingredientId`,
        ingredientId: item.ingredientId,
      });
    } else {
      byIngredientId.set(item.ingredientId, index);
    }

    if (isInvalidQuantity(item.availableQuantity)) {
      issues.push({
        code: "invalid_inventory_quantity",
        message: "Available quantity must be a finite number.",
        field: `${fieldPrefix}.availableQuantity`,
        ingredientId: item.ingredientId,
      });
    } else if (item.availableQuantity < 0) {
      issues.push({
        code: "invalid_inventory_quantity",
        message: "Available quantity cannot be negative.",
        field: `${fieldPrefix}.availableQuantity`,
        ingredientId: item.ingredientId,
      });
    }
  }

  for (const ingredientId of requiredIngredientIds) {
    if (!byIngredientId.has(ingredientId)) {
      issues.push({
        code: "missing_inventory",
        message: "Required ingredient is missing from inventory availability.",
        field: "inventory",
        ingredientId,
      });
    }
  }

  if (issues.length === 0) {
    return validationOk();
  }

  return validationFail(issues);
}
