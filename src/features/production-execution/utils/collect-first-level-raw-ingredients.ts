import type { FirstLevelRawIngredient } from "../types/production-session";

export interface FirstLevelRawItemSource {
  recipeId: string;
  ingredientId: string;
  quantity: number;
  unit: string;
}

export interface FirstLevelRawComponentSource {
  parentRecipeId: string;
  ingredientId: string | null;
  quantity: number;
  unit: string;
}

export interface IngredientNameLookup {
  name: string;
}

function toRawLine(
  ingredientId: string,
  quantity: number,
  unit: string,
  names: ReadonlyMap<string, IngredientNameLookup>,
): FirstLevelRawIngredient | null {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return null;
  }

  const lookup = names.get(ingredientId);

  return {
    ingredient_id: ingredientId,
    name: lookup?.name?.trim() ? lookup.name : "Unknown ingredient",
    quantity,
    unit,
  };
}

/**
 * First-level raw BOM lines for each recipe: recipe_items, then
 * recipe_components rows that target an ingredient_id (not a nested recipe).
 * Duplicates keep the first occurrence (items win over add-ins).
 */
export function collectFirstLevelRawIngredients(
  recipeIds: readonly string[],
  items: readonly FirstLevelRawItemSource[],
  components: readonly FirstLevelRawComponentSource[],
  names: ReadonlyMap<string, IngredientNameLookup>,
): Map<string, FirstLevelRawIngredient[]> {
  const byRecipeId = new Map<string, FirstLevelRawIngredient[]>();

  for (const recipeId of recipeIds) {
    const lines: FirstLevelRawIngredient[] = [];
    const seen = new Set<string>();

    for (const item of items) {
      if (item.recipeId !== recipeId) {
        continue;
      }

      const line = toRawLine(item.ingredientId, item.quantity, item.unit, names);
      if (!line || seen.has(line.ingredient_id)) {
        continue;
      }

      seen.add(line.ingredient_id);
      lines.push(line);
    }

    for (const component of components) {
      if (component.parentRecipeId !== recipeId || !component.ingredientId) {
        continue;
      }

      const line = toRawLine(
        component.ingredientId,
        component.quantity,
        component.unit,
        names,
      );
      if (!line || seen.has(line.ingredient_id)) {
        continue;
      }

      seen.add(line.ingredient_id);
      lines.push(line);
    }

    byRecipeId.set(recipeId, lines);
  }

  return byRecipeId;
}
