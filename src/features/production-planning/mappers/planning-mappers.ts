import { addQuantities, roundQuantity } from "@/lib/quantity";
import type { EntityId, Quantity, Unit } from "@/types/erp";

import { computeShortageQuantity } from "../domain/calculations";
import type { IngredientRequirement } from "../domain/ingredient-requirement";
import type { ProductionPlanLine } from "../domain/production-plan-line";
import type {
  PlanningRecipeIngredient,
  ResolvedRecipeBom,
} from "../types/recipe";

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
 * Aggregate raw ingredient needs from plan lines and resolved BOMs.
 * Lines whose recipe is missing from `bomsByRecipeId` are skipped
 * (callers should validate first).
 *
 * Aggregation happens before inventory comparison.
 * Complexity: O(lines × ingredients) with Map lookups — O(n) over BOM rows.
 */
export function aggregateIngredientNeeds(
  lines: readonly ProductionPlanLine[],
  bomsByRecipeId: ReadonlyMap<EntityId, ResolvedRecipeBom>,
  options?: AggregateIngredientNeedsOptions,
): IngredientRequirementDraft[] {
  const decimalPlaces = options?.quantityDecimalPlaces;
  const byIngredient = new Map<
    EntityId,
    { requiredQuantity: Quantity; unit: Unit }
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
      } else {
        byIngredient.set(ingredient.ingredientId, {
          requiredQuantity: scaled,
          unit: ingredient.unit,
        });
      }
    }
  }

  const drafts: IngredientRequirementDraft[] = [];
  for (const [ingredientId, value] of byIngredient) {
    drafts.push({
      ingredientId,
      requiredQuantity: value.requiredQuantity,
      unit: value.unit,
    });
  }
  return drafts;
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
