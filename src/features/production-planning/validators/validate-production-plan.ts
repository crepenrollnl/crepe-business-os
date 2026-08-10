import type { ActivationStatus, EntityId } from "@/types/erp";

import type { ProductionPlanLine } from "../domain/production-plan-line";
import type {
  PlanValidationIssue,
  ValidationResult,
} from "../types/validation";
import { validationFail, validationOk } from "../types/validation";

/**
 * Recipe availability context for plan validation.
 * Status comes from master data (ActivationStatus).
 */
export interface RecipeValidationContext {
  recipeId: EntityId;
  status: ActivationStatus;
  /** Yield must be positive for scaling; omitted when unknown. */
  yieldQuantity?: number;
}

export interface ValidateProductionPlanInput {
  lines: readonly ProductionPlanLine[];
  /**
   * Recipes keyed by recipe id. Missing keys are treated as missing_recipe.
   */
  recipesById: ReadonlyMap<EntityId, RecipeValidationContext>;
}

function isInvalidQuantity(value: number): boolean {
  return !Number.isFinite(value);
}

/**
 * Validate a production plan's lines against planning rules.
 *
 * Checks:
 * - empty plan (no lines)
 * - duplicate finished goods
 * - duplicate recipes
 * - invalid quantities (NaN / Infinity)
 * - negative quantities
 * - zero quantities
 * - missing recipe
 * - archived recipe
 * - non-positive recipe yield (when provided)
 *
 * Returns a typed ValidationResult. Never throws for validation failures.
 */
export function validateProductionPlan(
  input: ValidateProductionPlanInput,
): ValidationResult {
  const issues: PlanValidationIssue[] = [];
  const { lines, recipesById } = input;

  if (lines.length === 0) {
    issues.push({
      code: "empty_plan",
      message: "A production plan must include at least one line.",
      field: "lines",
    });
    return validationFail(issues);
  }

  const seenFinishedGoods = new Map<EntityId, number>();
  const seenRecipes = new Map<EntityId, number>();

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const fieldPrefix = `lines[${lineIndex}]`;

    const previousFinishedGoodIndex = seenFinishedGoods.get(
      line.finishedGoodId,
    );
    if (previousFinishedGoodIndex !== undefined) {
      issues.push({
        code: "duplicate_finished_good",
        message: "Each finished good may appear on at most one plan line.",
        field: `${fieldPrefix}.finishedGoodId`,
        finishedGoodId: line.finishedGoodId,
        lineIndex,
      });
    } else {
      seenFinishedGoods.set(line.finishedGoodId, lineIndex);
    }

    if (line.recipeId) {
      const previousRecipeIndex = seenRecipes.get(line.recipeId);
      if (previousRecipeIndex !== undefined) {
        issues.push({
          code: "duplicate_recipe",
          message: "Each recipe may appear on at most one plan line.",
          field: `${fieldPrefix}.recipeId`,
          finishedGoodId: line.finishedGoodId,
          recipeId: line.recipeId,
          lineIndex,
        });
      } else {
        seenRecipes.set(line.recipeId, lineIndex);
      }
    }

    if (isInvalidQuantity(line.plannedQuantity)) {
      issues.push({
        code: "invalid_quantity",
        message: "Planned quantity must be a finite number.",
        field: `${fieldPrefix}.plannedQuantity`,
        finishedGoodId: line.finishedGoodId,
        recipeId: line.recipeId,
        lineIndex,
      });
    } else if (line.plannedQuantity < 0) {
      issues.push({
        code: "negative_quantity",
        message: "Planned quantity cannot be negative.",
        field: `${fieldPrefix}.plannedQuantity`,
        finishedGoodId: line.finishedGoodId,
        recipeId: line.recipeId,
        lineIndex,
      });
    } else if (line.plannedQuantity === 0) {
      issues.push({
        code: "zero_quantity",
        message: "Planned quantity must be greater than zero.",
        field: `${fieldPrefix}.plannedQuantity`,
        finishedGoodId: line.finishedGoodId,
        recipeId: line.recipeId,
        lineIndex,
      });
    }

    const recipeId = line.recipeId;
    if (!recipeId) {
      issues.push({
        code: "missing_recipe",
        message: "Each plan line must reference a recipe.",
        field: `${fieldPrefix}.recipeId`,
        finishedGoodId: line.finishedGoodId,
        lineIndex,
      });
      continue;
    }

    const recipe = recipesById.get(recipeId);
    if (!recipe) {
      issues.push({
        code: "missing_recipe",
        message: "Referenced recipe was not found.",
        field: `${fieldPrefix}.recipeId`,
        finishedGoodId: line.finishedGoodId,
        recipeId,
        lineIndex,
      });
      continue;
    }

    if (recipe.status === "archived") {
      issues.push({
        code: "archived_recipe",
        message: "Archived recipes cannot be used in production planning.",
        field: `${fieldPrefix}.recipeId`,
        finishedGoodId: line.finishedGoodId,
        recipeId,
        lineIndex,
      });
    }

    if (
      recipe.yieldQuantity !== undefined &&
      (isInvalidQuantity(recipe.yieldQuantity) || recipe.yieldQuantity <= 0)
    ) {
      issues.push({
        code: "invalid_quantity",
        message: "Recipe yield quantity must be a positive finite number.",
        field: `${fieldPrefix}.recipeId`,
        finishedGoodId: line.finishedGoodId,
        recipeId,
        lineIndex,
      });
    }
  }

  if (issues.length === 0) {
    return validationOk();
  }

  return validationFail(issues);
}
