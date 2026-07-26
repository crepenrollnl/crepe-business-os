import type { EntityId } from "@/types/erp";

import { buildPlanningSummary } from "../domain/calculations";
import type { PlanningResult } from "../domain/planning-result";
import type { ProductionPlan } from "../domain/production-plan";
import type { ProductionPlanLine } from "../domain/production-plan-line";
import {
  aggregateIngredientNeeds,
  mapIngredientRequirements,
} from "../mappers/planning-mappers";
import type { PlanningCalculationConfig } from "../types/config";
import { resolvePlanningCalculationConfig } from "../types/config";
import type { PlanningInventoryItem } from "../types/inventory";
import type {
  PlanningRecipe,
  PlanningRecipeIngredientLine,
  ResolvedRecipeBom,
} from "../types/recipe";
import type { PlanValidationIssue } from "../types/validation";
import { validatePlanningInventory } from "../validators/validate-planning-inventory";
import { validateProductionPlan } from "../validators/validate-production-plan";

/**
 * Full calculator input. All data is passed in — no I/O, no hidden state.
 */
export interface CalculateProductionPlanInput {
  plan: ProductionPlan;
  lines: readonly ProductionPlanLine[];
  recipes: readonly PlanningRecipe[];
  recipeIngredients: readonly PlanningRecipeIngredientLine[];
  inventory: readonly PlanningInventoryItem[];
  config?: Partial<PlanningCalculationConfig>;
}

/**
 * Calculator output. Business validation never throws.
 */
export type CalculateProductionPlanOutput =
  | { ok: true; result: PlanningResult }
  | { ok: false; issues: readonly PlanValidationIssue[] };

function shallowClonePlan(
  plan: ProductionPlan,
  status: ProductionPlan["status"],
): ProductionPlan {
  return {
    id: plan.id,
    name: plan.name,
    status,
    plannedDate: plan.plannedDate,
    notes: plan.notes,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  };
}

function clonePlanLines(
  lines: readonly ProductionPlanLine[],
): ProductionPlanLine[] {
  return lines.map((line) => ({
    finishedGoodId: line.finishedGoodId,
    recipeId: line.recipeId,
    plannedQuantity: line.plannedQuantity,
    unit: line.unit,
  }));
}

/**
 * STEP 2 — Resolve recipes referenced by plan lines into BOMs.
 * Returns null when validation already failed (caller should stop).
 */
function resolveRecipeBoms(
  lines: readonly ProductionPlanLine[],
  recipes: readonly PlanningRecipe[],
  recipeIngredients: readonly PlanningRecipeIngredientLine[],
): {
  bomsByRecipeId: Map<EntityId, ResolvedRecipeBom>;
  recipesById: Map<
    EntityId,
    {
      recipeId: EntityId;
      status: PlanningRecipe["status"];
      yieldQuantity: number;
    }
  >;
} {
  const recipesById = new Map<
    EntityId,
    {
      recipeId: EntityId;
      status: PlanningRecipe["status"];
      yieldQuantity: number;
    }
  >();

  for (const recipe of recipes) {
    recipesById.set(recipe.id, {
      recipeId: recipe.id,
      status: recipe.status,
      yieldQuantity: recipe.yieldQuantity,
    });
  }

  const ingredientsByRecipeId = new Map<
    EntityId,
    PlanningRecipeIngredientLine[]
  >();

  for (const ingredient of recipeIngredients) {
    const existing = ingredientsByRecipeId.get(ingredient.recipeId);
    if (existing) {
      existing.push(ingredient);
    } else {
      ingredientsByRecipeId.set(ingredient.recipeId, [ingredient]);
    }
  }

  const bomsByRecipeId = new Map<EntityId, ResolvedRecipeBom>();
  const recipesByEntity = new Map(
    recipes.map((recipe) => [recipe.id, recipe] as const),
  );

  for (const line of lines) {
    if (bomsByRecipeId.has(line.recipeId)) {
      continue;
    }
    const recipe = recipesByEntity.get(line.recipeId);
    if (!recipe) {
      continue;
    }
    const ingredients = ingredientsByRecipeId.get(line.recipeId) ?? [];
    bomsByRecipeId.set(line.recipeId, {
      recipe,
      ingredients: ingredients.map((ingredient) => ({
        ingredientId: ingredient.ingredientId,
        quantityPerYield: ingredient.quantityPerYield,
        unit: ingredient.unit,
      })),
    });
  }

  return { bomsByRecipeId, recipesById };
}

/**
 * Production Planning Calculation Engine.
 *
 * Pipeline:
 * 1. Validate Production Plan
 * 2. Resolve Recipes
 * 3. Expand Recipe Ingredients
 * 4. Aggregate identical Ingredients
 * 5. Load Inventory Availability
 * 6–8. Required / Available / Shortage
 * 9. Generate Planning Summary
 *
 * Pure and deterministic. Never mutates inputs. Never persists.
 */
export function calculateProductionPlan(
  input: CalculateProductionPlanInput,
): CalculateProductionPlanOutput {
  const config = resolvePlanningCalculationConfig(input.config);
  const lines = clonePlanLines(input.lines);

  // STEP 2 (partial) — index recipes for validation + resolution
  const { bomsByRecipeId, recipesById } = resolveRecipeBoms(
    lines,
    input.recipes,
    input.recipeIngredients,
  );

  // STEP 1 — Validate Production Plan
  const planValidation = validateProductionPlan({
    lines,
    recipesById,
  });

  if (!planValidation.ok) {
    return { ok: false, issues: planValidation.issues };
  }

  // STEP 3 + 4 — Expand + Aggregate identical ingredients (before inventory)
  const drafts = aggregateIngredientNeeds(lines, bomsByRecipeId, {
    quantityDecimalPlaces: config.quantityDecimalPlaces,
  });

  const requiredIngredientIds = drafts.map((draft) => draft.ingredientId);

  // STEP 5 — Validate + load inventory availability
  const inventoryValidation = validatePlanningInventory({
    inventory: input.inventory,
    requiredIngredientIds,
  });

  if (!inventoryValidation.ok) {
    return { ok: false, issues: inventoryValidation.issues };
  }

  const availableByIngredientId = new Map<EntityId, number>();
  const ingredientNamesById = new Map<EntityId, string>();
  for (const item of input.inventory) {
    availableByIngredientId.set(item.ingredientId, item.availableQuantity);
    if (item.ingredientName && item.ingredientName.trim().length > 0) {
      ingredientNamesById.set(item.ingredientId, item.ingredientName.trim());
    }
  }

  // STEP 6–8 — Required, Available, Shortage
  const ingredientRequirements = mapIngredientRequirements(
    drafts,
    availableByIngredientId,
    {
      quantityDecimalPlaces: config.quantityDecimalPlaces,
      ingredientNamesById,
    },
  );

  // STEP 9 — Generate Planning Summary (+ derived status)
  const summary = buildPlanningSummary(lines, ingredientRequirements);
  const plan = shallowClonePlan(input.plan, summary.status);

  const result: PlanningResult = {
    plan,
    lines,
    ingredientRequirements,
    summary,
  };

  return { ok: true, result };
}
