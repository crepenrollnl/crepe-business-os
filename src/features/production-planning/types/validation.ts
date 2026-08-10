import type { EntityId } from "@/types/erp";

/**
 * Typed validation issue codes for Production Planning.
 * Validation failures never throw — they return ValidationResult.
 */
export type PlanValidationIssueCode =
  | "empty_plan"
  | "duplicate_finished_good"
  | "duplicate_recipe"
  | "invalid_quantity"
  | "negative_quantity"
  | "zero_quantity"
  | "missing_recipe"
  | "archived_recipe"
  | "missing_inventory"
  | "duplicate_inventory"
  | "invalid_inventory_quantity"
  | "invalid_planning_result"
  | "duplicate_ingredient"
  | "inconsistent_ingredient_unit"
  | "negative_shortage"
  | "invalid_shopping_list"
  | "invalid_package_size"
  | "zero_package_size"
  | "negative_package_size"
  | "invalid_procurement_recommendation"
  | "empty_procurement_recommendation";

export interface PlanValidationIssue {
  code: PlanValidationIssueCode;
  message: string;
  /** Optional field path for form binding (e.g. `lines[0].plannedQuantity`). */
  field?: string;
  finishedGoodId?: EntityId;
  recipeId?: EntityId;
  ingredientId?: EntityId;
  lineIndex?: number;
}

/**
 * Discriminated validation result.
 * Callers must branch on `ok` — never catch exceptions for validation.
 */
export type ValidationResult =
  | { ok: true; issues: readonly [] }
  | { ok: false; issues: readonly PlanValidationIssue[] };

export function validationOk(): ValidationResult {
  return { ok: true, issues: [] };
}

export function validationFail(
  issues: readonly PlanValidationIssue[],
): ValidationResult {
  if (issues.length === 0) {
    return validationOk();
  }
  return { ok: false, issues };
}
