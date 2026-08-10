import { addQuantities, roundQuantity } from "@/lib/quantity";
import type { EntityId, Quantity, Unit } from "@/types/erp";

import { computeShortageQuantity } from "../domain/calculations";
import type { IngredientRequirement } from "../domain/ingredient-requirement";
import type { ProductionPlanLine } from "../domain/production-plan-line";
import type {
  PlanningRecipeIngredient,
  ResolvedRecipeBom,
} from "../types/recipe";
import type { PlanValidationIssue } from "../types/validation";

export interface IngredientRequirementDraft {
  ingredientId: EntityId;
  requiredQuantity: Quantity;
  unit: Unit;
}

export interface PurchaseShortageSuggestion {
  ingredientId: EntityId;
  suggestedQuantity: Quantity;
  unit: Unit;
}

export interface ScaleRecipeIngredientOptions {
  quantityDecimalPlaces?: number;
}

/**
 * Scale a BOM ingredient by planned quantity relative to recipe yield.
 * Pure math — no inventory access.
 */
export function scaleRecipeIngredientNeed(
  ingredient: PlanningRecipeIngredient,
  plannedQuantity: Quantity,
  yieldQuantity: Quantity,
  options?: ScaleRecipeIngredientOptions,
): Quantity {
  if (yieldQuantity <= 0) {
    return 0;
  }
  const scaled =
    (ingredient.quantityPerYield * plannedQuantity) / yieldQuantity;
  return roundQuantity(scaled, options?.quantityDecimalPlaces);
}

export interface AggregateIngredientNeedsOptions {
  quantityDecimalPlaces?: number;
}

/**
 * Discriminated result of `aggregateIngredientNeeds`. `recipe_items.unit`
 * is a free-text snapshot (see planning-mappers module docs / AGENTS.md
 * unit-consistency finding) that can drift from an ingredient's current
 * unit once any one recipe is re-saved. Summing raw quantities across
 * recipes that disagree on unit for the same ingredient would silently
 * produce a meaningless number, so a conflict is surfaced as an issue
 * instead of guessing which unit is "right".
 */
export type AggregateIngredientNeedsResult =
  | { ok: true; drafts: IngredientRequirementDraft[] }
  | { ok: false; issues: readonly PlanValidationIssue[] };

/**
 * Aggregate raw ingredient needs from plan lines and resolved BOMs.
 * Lines whose recipe is missing from `bomsByRecipeId` are skipped
 * (callers should validate first).
 *
 * Aggregation happens before inventory comparison. Every distinct unit
 * seen per ingredient is tracked; an ingredient aggregated from BOM rows
 * that disagree on unit fails with `inconsistent_ingredient_unit` instead
 * of silently summing mismatched units under the first unit encountered.
 *
 * Complexity: O(lines × ingredients) with Map lookups — O(n) over BOM rows.
 */
export function aggregateIngredientNeeds(
  lines: readonly ProductionPlanLine[],
  bomsByRecipeId: ReadonlyMap<EntityId, ResolvedRecipeBom>,
  options?: AggregateIngredientNeedsOptions,
): AggregateIngredientNeedsResult {
  const decimalPlaces = options?.quantityDecimalPlaces;
  const byIngredient = new Map<
    EntityId,
    { requiredQuantity: Quantity; unit: Unit; units: Set<Unit> }
  >();

  for (const line of lines) {
    const bom = bomsByRecipeId.get(line.recipeId);
    if (!bom) {
      continue;
    }

    for (const ingredient of bom.ingredients) {
      const scaled = scaleRecipeIngredientNeed(
        ingredient,
        line.plannedQuantity,
        bom.recipe.yieldQuantity,
        { quantityDecimalPlaces: decimalPlaces },
      );
      const existing = byIngredient.get(ingredient.ingredientId);
      if (existing) {
        existing.requiredQuantity = addQuantities(
          existing.requiredQuantity,
          scaled,
          decimalPlaces,
        );
        existing.units.add(ingredient.unit);
      } else {
        byIngredient.set(ingredient.ingredientId, {
          requiredQuantity: scaled,
          unit: ingredient.unit,
          units: new Set([ingredient.unit]),
        });
      }
    }
  }

  const issues: PlanValidationIssue[] = [];
  for (const [ingredientId, value] of byIngredient) {
    if (value.units.size > 1) {
      const conflictingUnits = [...value.units]
        .map((unit) => `"${unit}"`)
        .join(", ");
      issues.push({
        code: "inconsistent_ingredient_unit",
        message: `Ingredient has inconsistent units across recipes: found ${conflictingUnits}. Fix the affected recipes (each recipe line stores the ingredient's unit as it was when saved) before planning.`,
        ingredientId,
      });
    }
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  const drafts: IngredientRequirementDraft[] = [];
  for (const [ingredientId, value] of byIngredient) {
    drafts.push({
      ingredientId,
      requiredQuantity: value.requiredQuantity,
      unit: value.unit,
    });
  }
  return { ok: true, drafts };
}

export interface MapIngredientRequirementsOptions {
  quantityDecimalPlaces?: number;
  /**
   * Display names keyed by ingredient id.
   * Missing entries fall back to the ingredient id.
   */
  ingredientNamesById?: ReadonlyMap<EntityId, string>;
}

/**
 * Attach read-only availability and derived shortage to aggregated needs.
 * Callers must ensure every draft ingredient exists in availability
 * (validate missing inventory first).
 */
export function mapIngredientRequirements(
  drafts: readonly IngredientRequirementDraft[],
  availableByIngredientId: ReadonlyMap<EntityId, Quantity>,
  options?: MapIngredientRequirementsOptions,
): IngredientRequirement[] {
  const decimalPlaces = options?.quantityDecimalPlaces;
  const namesById = options?.ingredientNamesById;

  return drafts.map((draft) => {
    const rawAvailable =
      availableByIngredientId.get(draft.ingredientId) ?? 0;
    const availableQuantity = roundQuantity(rawAvailable, decimalPlaces);
    const requiredQuantity = roundQuantity(
      draft.requiredQuantity,
      decimalPlaces,
    );
    const shortageQuantity = roundQuantity(
      computeShortageQuantity(requiredQuantity, availableQuantity),
      decimalPlaces,
    );
    const ingredientName =
      namesById?.get(draft.ingredientId)?.trim() || draft.ingredientId;

    return {
      ingredientId: draft.ingredientId,
      ingredientName,
      requiredQuantity,
      availableQuantity,
      shortageQuantity,
      unit: draft.unit,
    };
  });
}

/**
 * Build purchase-suggestion quantities from shortages only.
 * Does not create purchases — mapping helper for suggestion providers.
 */
export function mapShortageSuggestions(
  requirements: readonly IngredientRequirement[],
): readonly PurchaseShortageSuggestion[] {
  const suggestions: PurchaseShortageSuggestion[] = [];

  for (const requirement of requirements) {
    if (requirement.shortageQuantity > 0) {
      suggestions.push({
        ingredientId: requirement.ingredientId,
        suggestedQuantity: requirement.shortageQuantity,
        unit: requirement.unit,
      });
    }
  }

  return suggestions;
}
