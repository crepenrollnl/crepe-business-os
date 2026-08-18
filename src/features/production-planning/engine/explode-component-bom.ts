import type { EntityId, Quantity, Unit } from "@/types/erp";

import type {
  PlanningRecipe,
  PlanningRecipeComponentLine,
  PlanningRecipeIngredient,
  PlanningRecipeIngredientLine,
} from "../types/recipe";
import type { PlanValidationIssue } from "../types/validation";

export type ExplodeComponentRecipeBomResult =
  | { ok: true; ingredients: readonly PlanningRecipeIngredient[] }
  | { ok: false; issues: readonly PlanValidationIssue[] };

function recipeRoleOf(
  recipe: PlanningRecipe,
): NonNullable<PlanningRecipe["recipeRole"]> {
  return recipe.recipeRole ?? "component";
}

function mergeLeaf(
  byIngredient: Map<
    EntityId,
    { quantityPerYield: Quantity; unit: Unit; units: Set<Unit> }
  >,
  ingredientId: EntityId,
  quantityPerYield: Quantity,
  unit: Unit,
): void {
  const existing = byIngredient.get(ingredientId);
  if (existing) {
    existing.quantityPerYield += quantityPerYield;
    existing.units.add(unit);
    return;
  }

  byIngredient.set(ingredientId, {
    quantityPerYield,
    unit,
    units: new Set([unit]),
  });
}

/**
 * Recursively expand a Component recipe's `recipe_components` into leaf
 * `recipe_items` quantities, expressed per 1 yield unit of `rootRecipeId`.
 *
 * Only parents with `recipeRole = 'component'` (the Planning default) are
 * walked. Assembly `recipe_components` are left untouched — Sales/FIFO
 * owns those (ADR-0001 / sql/101).
 *
 * Pure: no I/O. Cycle detection uses the current DFS path, so a diamond
 * (A→B and A→C, both using flour) is not a cycle.
 */
export function explodeComponentRecipeBom(
  rootRecipeId: EntityId,
  recipes: readonly PlanningRecipe[],
  recipeIngredients: readonly PlanningRecipeIngredientLine[],
  recipeComponents: readonly PlanningRecipeComponentLine[] = [],
): ExplodeComponentRecipeBomResult {
  const recipesById = new Map(recipes.map((recipe) => [recipe.id, recipe]));
  const ingredientsByRecipeId = new Map<EntityId, PlanningRecipeIngredientLine[]>();
  const componentsByParentId = new Map<EntityId, PlanningRecipeComponentLine[]>();

  for (const line of recipeIngredients) {
    const existing = ingredientsByRecipeId.get(line.recipeId);
    if (existing) {
      existing.push(line);
    } else {
      ingredientsByRecipeId.set(line.recipeId, [line]);
    }
  }

  for (const line of recipeComponents) {
    const existing = componentsByParentId.get(line.parentRecipeId);
    if (existing) {
      existing.push(line);
    } else {
      componentsByParentId.set(line.parentRecipeId, [line]);
    }
  }

  const issues: PlanValidationIssue[] = [];
  const byIngredient = new Map<
    EntityId,
    { quantityPerYield: Quantity; unit: Unit; units: Set<Unit> }
  >();

  function walk(
    recipeId: EntityId,
    multiplier: Quantity,
    path: ReadonlySet<EntityId>,
  ): void {
    if (issues.length > 0) {
      return;
    }

    if (path.has(recipeId)) {
      issues.push({
        code: "circular_recipe_component",
        message:
          "Recipe sub-components form a cycle. Remove the circular reference before planning or producing.",
        recipeId,
      });
      return;
    }

    const recipe = recipesById.get(recipeId);
    if (!recipe) {
      issues.push({
        code: "missing_recipe",
        message: "Referenced recipe was not found.",
        recipeId,
      });
      return;
    }

    for (const item of ingredientsByRecipeId.get(recipeId) ?? []) {
      mergeLeaf(
        byIngredient,
        item.ingredientId,
        item.quantityPerYield * multiplier,
        item.unit,
      );
    }

    if (recipeRoleOf(recipe) !== "component") {
      return;
    }

    const nextPath = new Set(path);
    nextPath.add(recipeId);

    for (const component of componentsByParentId.get(recipeId) ?? []) {
      if (component.ingredientId) {
        mergeLeaf(
          byIngredient,
          component.ingredientId,
          component.quantityPerYield * multiplier,
          component.unit,
        );
        continue;
      }

      const childId = component.componentRecipeId;
      if (!childId) {
        continue;
      }

      const child = recipesById.get(childId);
      if (!child) {
        issues.push({
          code: "missing_recipe",
          message: "Referenced recipe was not found.",
          recipeId: childId,
        });
        return;
      }

      if (!Number.isFinite(child.yieldQuantity) || child.yieldQuantity <= 0) {
        issues.push({
          code: "invalid_quantity",
          message: "Recipe yield quantity must be a positive finite number.",
          recipeId: childId,
        });
        return;
      }

      walk(
        childId,
        (multiplier * component.quantityPerYield) / child.yieldQuantity,
        nextPath,
      );
    }
  }

  walk(rootRecipeId, 1, new Set());

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  const unitIssues: PlanValidationIssue[] = [];
  const ingredients: PlanningRecipeIngredient[] = [];

  for (const [ingredientId, value] of byIngredient) {
    if (value.units.size > 1) {
      const conflictingUnits = [...value.units]
        .map((unit) => `"${unit}"`)
        .join(", ");
      unitIssues.push({
        code: "inconsistent_ingredient_unit",
        message: `Ingredient has inconsistent units across recipes: found ${conflictingUnits}. Fix the affected recipes (each recipe line stores the ingredient's unit as it was when saved) before planning.`,
        ingredientId,
      });
      continue;
    }

    ingredients.push({
      ingredientId,
      quantityPerYield: value.quantityPerYield,
      unit: value.unit,
    });
  }

  if (unitIssues.length > 0) {
    return { ok: false, issues: unitIssues };
  }

  return { ok: true, ingredients };
}
