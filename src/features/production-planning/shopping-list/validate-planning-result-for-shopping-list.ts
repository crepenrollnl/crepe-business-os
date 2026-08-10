import type { EntityId } from "@/types/erp";

import type { PlanningResult } from "../domain/planning-result";
import type {
  PlanValidationIssue,
  ValidationResult,
} from "../types/validation";
import { validationFail, validationOk } from "../types/validation";

function isInvalidQuantity(value: number): boolean {
  return !Number.isFinite(value);
}

function isInvalidPlanningResultShape(result: PlanningResult): boolean {
  if (result == null || typeof result !== "object") {
    return true;
  }
  if (!Array.isArray(result.ingredientRequirements)) {
    return true;
  }
  if (result.summary == null || typeof result.summary !== "object") {
    return true;
  }
  if (!Array.isArray(result.lines)) {
    return true;
  }
  if (result.plan == null || typeof result.plan !== "object") {
    return true;
  }
  return false;
}

/**
 * Validate a PlanningResult before shopping-list generation.
 *
 * Checks:
 * - invalid / malformed Planning Result
 * - duplicate ingredient entries
 * - negative shortages
 * - non-finite shortage / stock / required quantities
 *
 * Never mutates the Planning Result. Never throws for validation failures.
 */
export function validatePlanningResultForShoppingList(
  result: PlanningResult,
): ValidationResult {
  if (isInvalidPlanningResultShape(result)) {
    return validationFail([
      {
        code: "invalid_planning_result",
        message: "Planning result is missing or malformed.",
        field: "planningResult",
      },
    ]);
  }

  const issues: PlanValidationIssue[] = [];
  const seenIngredients = new Map<EntityId, number>();
  const requirements = result.ingredientRequirements;

  for (let index = 0; index < requirements.length; index += 1) {
    const requirement = requirements[index];
    const fieldPrefix = `ingredientRequirements[${index}]`;

    if (
      requirement == null ||
      typeof requirement !== "object" ||
      typeof requirement.ingredientId !== "string" ||
      requirement.ingredientId.length === 0 ||
      typeof requirement.unit !== "string" ||
      typeof requirement.ingredientName !== "string"
    ) {
      issues.push({
        code: "invalid_planning_result",
        message: "Ingredient requirement entry is invalid.",
        field: fieldPrefix,
        ingredientId:
          requirement &&
          typeof requirement === "object" &&
          typeof (requirement as { ingredientId?: unknown }).ingredientId ===
            "string"
            ? (requirement as { ingredientId: EntityId }).ingredientId
            : undefined,
      });
      continue;
    }

    const previousIndex = seenIngredients.get(requirement.ingredientId);
    if (previousIndex !== undefined) {
      issues.push({
        code: "duplicate_ingredient",
        message:
          "Planning result must not contain duplicate ingredient requirements.",
        field: `${fieldPrefix}.ingredientId`,
        ingredientId: requirement.ingredientId,
      });
    } else {
      seenIngredients.set(requirement.ingredientId, index);
    }

    if (isInvalidQuantity(requirement.shortageQuantity)) {
      issues.push({
        code: "invalid_planning_result",
        message: "Shortage quantity must be a finite number.",
        field: `${fieldPrefix}.shortageQuantity`,
        ingredientId: requirement.ingredientId,
      });
    } else if (requirement.shortageQuantity < 0) {
      issues.push({
        code: "negative_shortage",
        message: "Shortage quantity cannot be negative.",
        field: `${fieldPrefix}.shortageQuantity`,
        ingredientId: requirement.ingredientId,
      });
    }

    if (isInvalidQuantity(requirement.requiredQuantity)) {
      issues.push({
        code: "invalid_planning_result",
        message: "Required quantity must be a finite number.",
        field: `${fieldPrefix}.requiredQuantity`,
        ingredientId: requirement.ingredientId,
      });
    } else if (requirement.requiredQuantity < 0) {
      issues.push({
        code: "invalid_planning_result",
        message: "Required quantity cannot be negative.",
        field: `${fieldPrefix}.requiredQuantity`,
        ingredientId: requirement.ingredientId,
      });
    }

    if (isInvalidQuantity(requirement.availableQuantity)) {
      issues.push({
        code: "invalid_planning_result",
        message: "Available quantity must be a finite number.",
        field: `${fieldPrefix}.availableQuantity`,
        ingredientId: requirement.ingredientId,
      });
    } else if (requirement.availableQuantity < 0) {
      issues.push({
        code: "invalid_planning_result",
        message: "Available quantity cannot be negative.",
        field: `${fieldPrefix}.availableQuantity`,
        ingredientId: requirement.ingredientId,
      });
    }
  }

  if (issues.length === 0) {
    return validationOk();
  }

  return validationFail(issues);
}
