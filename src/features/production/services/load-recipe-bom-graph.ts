/**
 * Loads the reachable Component-in-Component recipe graph for Planning
 * and Production Execution. Read-only. Does not explode — callers pass
 * the result into explodeComponentRecipeBom / calculateProductionPlan.
 */

import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import type {
  PlanningRecipe,
  PlanningRecipeComponentLine,
  PlanningRecipeIngredientLine,
} from "@/features/production-planning";
import type { RecipeRole } from "@/features/recipes/types/recipe";

export const NESTED_COMPONENT_RECIPE_ERROR =
  "This recipe is used as a sub-component of another Component recipe and cannot be planned or produced on its own.";

interface GraphRecipeRow {
  id: string;
  name: string;
  yield_quantity: number | string;
  yield_unit: string;
  is_active: boolean;
  recipe_role: RecipeRole | string | null;
}

interface GraphItemRow {
  recipe_id: string;
  ingredient_id: string;
  quantity: number | string;
  unit: string;
}

interface GraphComponentRow {
  assembly_recipe_id: string;
  component_recipe_id: string | null;
  ingredient_id: string | null;
  quantity: number | string;
  unit: string;
}

export interface LoadedRecipeGraph {
  recipes: PlanningRecipe[];
  recipeIngredients: PlanningRecipeIngredientLine[];
  recipeComponents: PlanningRecipeComponentLine[];
  recipeNameById: Map<string, string>;
  recipeRowsById: Map<string, GraphRecipeRow>;
}

function toNumber(value: number | string): number {
  return typeof value === "number" ? value : Number(value);
}

function toRecipeRole(value: string | null | undefined): RecipeRole {
  return value === "assembly" ? "assembly" : "component";
}

/**
 * Live set of recipe ids currently used as a sub-component of a
 * Component-role parent. Re-queried every call — recipe_components is
 * not cached, because a recipe can become nested after it was created.
 */
export async function fetchNestedComponentRecipeIds(): Promise<
  ServiceResult<Set<string>>
> {
  const componentsResult = await supabase
    .from("recipe_components")
    .select("assembly_recipe_id, component_recipe_id")
    .not("component_recipe_id", "is", null);

  if (componentsResult.error) {
    return fail(
      toUserError(
        componentsResult.error,
        "Failed to load recipe components",
      ),
    );
  }

  const componentRows = (componentsResult.data ?? []) as GraphComponentRow[];
  const parentIds = [
    ...new Set(componentRows.map((row) => row.assembly_recipe_id)),
  ];

  if (parentIds.length === 0) {
    return ok(new Set());
  }

  const parentsResult = await supabase
    .from("recipes")
    .select("id, recipe_role")
    .in("id", parentIds);

  if (parentsResult.error) {
    return fail(toUserError(parentsResult.error, "Failed to load recipes"));
  }

  const componentParentIds = new Set(
    ((parentsResult.data ?? []) as Array<{ id: string; recipe_role: string | null }>)
      .filter((row) => toRecipeRole(row.recipe_role) === "component")
      .map((row) => row.id),
  );

  const nested = new Set<string>();
  for (const row of componentRows) {
    if (
      row.component_recipe_id &&
      componentParentIds.has(row.assembly_recipe_id)
    ) {
      nested.add(row.component_recipe_id);
    }
  }

  return ok(nested);
}

export async function loadRecipeBomGraph(
  rootRecipeIds: readonly string[],
): Promise<ServiceResult<LoadedRecipeGraph>> {
  const uniqueRoots = [...new Set(rootRecipeIds.filter((id) => id.length > 0))];
  const recipesById = new Map<string, GraphRecipeRow>();
  const itemRows: GraphItemRow[] = [];
  const componentRows: GraphComponentRow[] = [];
  const seen = new Set<string>();
  let frontier = uniqueRoots;

  while (frontier.length > 0) {
    const batch = frontier.filter((id) => !seen.has(id));
    for (const id of batch) {
      seen.add(id);
    }
    if (batch.length === 0) {
      break;
    }

    const [recipesResult, itemsResult, componentsResult] = await Promise.all([
      supabase
        .from("recipes")
        .select("id, name, yield_quantity, yield_unit, is_active, recipe_role")
        .in("id", batch),
      supabase
        .from("recipe_items")
        .select("recipe_id, ingredient_id, quantity, unit")
        .in("recipe_id", batch),
      supabase
        .from("recipe_components")
        .select(
          "assembly_recipe_id, component_recipe_id, ingredient_id, quantity, unit",
        )
        .in("assembly_recipe_id", batch),
    ]);

    if (recipesResult.error) {
      return fail(toUserError(recipesResult.error, "Failed to load recipes"));
    }
    if (itemsResult.error) {
      return fail(
        toUserError(itemsResult.error, "Failed to load recipe ingredients"),
      );
    }
    if (componentsResult.error) {
      return fail(
        toUserError(componentsResult.error, "Failed to load recipe components"),
      );
    }

    for (const row of (recipesResult.data ?? []) as GraphRecipeRow[]) {
      recipesById.set(row.id, row);
    }

    itemRows.push(...((itemsResult.data ?? []) as GraphItemRow[]));

    const loadedComponents = (componentsResult.data ?? []) as GraphComponentRow[];
    componentRows.push(...loadedComponents);

    const next: string[] = [];
    for (const row of loadedComponents) {
      if (!row.component_recipe_id) {
        continue;
      }
      const parent = recipesById.get(row.assembly_recipe_id);
      if (toRecipeRole(parent?.recipe_role) !== "component") {
        continue;
      }
      if (!seen.has(row.component_recipe_id)) {
        next.push(row.component_recipe_id);
      }
    }
    frontier = next;
  }

  const recipes: PlanningRecipe[] = [...recipesById.values()].map((row) => ({
    id: row.id,
    finishedGoodId: row.id,
    status: row.is_active ? "active" : "inactive",
    yieldQuantity: toNumber(row.yield_quantity),
    yieldUnit: row.yield_unit,
    recipeRole: toRecipeRole(row.recipe_role),
  }));

  const recipeIngredients: PlanningRecipeIngredientLine[] = itemRows.map(
    (row) => ({
      recipeId: row.recipe_id,
      ingredientId: row.ingredient_id,
      quantityPerYield: toNumber(row.quantity),
      unit: row.unit,
    }),
  );

  const recipeComponents: PlanningRecipeComponentLine[] = componentRows.map(
    (row) => ({
      parentRecipeId: row.assembly_recipe_id,
      componentRecipeId: row.component_recipe_id,
      ingredientId: row.ingredient_id,
      quantityPerYield: toNumber(row.quantity),
      unit: row.unit,
    }),
  );

  const recipeNameById = new Map(
    [...recipesById.values()].map((row) => [row.id, row.name]),
  );

  return ok({
    recipes,
    recipeIngredients,
    recipeComponents,
    recipeNameById,
    recipeRowsById: recipesById,
  });
}
