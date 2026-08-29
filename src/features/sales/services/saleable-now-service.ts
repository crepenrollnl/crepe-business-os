/**
 * Saleable Now (Mode A): how many assembly portions confirm_sale can ship
 * from current finished-goods remaining and raw add-in stock.
 *
 * Does not explode component BOMs or hypothetically produce missing
 * components. Does not write stock or call RPCs.
 */

import { inventoryService } from "@/features/inventory/services/inventory-service";
import { recipeService } from "@/features/recipes/services/recipe-service";
import { reportService } from "@/features/reports/services/report-service";
import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import {
  computeMaxSaleableNow,
  type SaleableNowBomLine,
  type SaleableNowRow,
} from "../utils/max-saleable-now";

interface RecipeComponentRow {
  id: string;
  assembly_recipe_id: string;
  component_recipe_id: string | null;
  ingredient_id: string | null;
  quantity: number | string;
}

function toNumber(value: number | string): number {
  return typeof value === "number" ? value : Number(value);
}

function isPosSaleableRecipe(recipe: {
  is_active: boolean;
  recipe_role: string;
  selling_price: number | null;
}): boolean {
  return (
    recipe.is_active &&
    recipe.recipe_role === "assembly" &&
    recipe.selling_price !== null
  );
}

export async function listSaleableNow(): Promise<
  ServiceResult<SaleableNowRow[]>
> {
  try {
    const [recipesResult, fgResult, inventoryResult] = await Promise.all([
      recipeService.getRecipes(),
      reportService.getFinishedGoodsSummary(),
      inventoryService.getInventory(),
    ]);

    if (recipesResult.error || !recipesResult.data) {
      return fail(recipesResult.error ?? "Failed to load recipes");
    }

    if (fgResult.error || !fgResult.data) {
      return fail(fgResult.error ?? "Failed to load finished goods summary");
    }

    if (inventoryResult.error || !inventoryResult.data) {
      return fail(inventoryResult.error ?? "Failed to load inventory");
    }

    const products = recipesResult.data
      .filter(isPosSaleableRecipe)
      .map((recipe) => ({
        id: recipe.id,
        name: recipe.name,
      }));

    if (products.length === 0) {
      return ok([]);
    }

    const assemblyIds = products.map((product) => product.id);

    const { data: componentData, error: componentError } = await supabase
      .from("recipe_components")
      .select(
        "id, assembly_recipe_id, component_recipe_id, ingredient_id, quantity",
      )
      .in("assembly_recipe_id", assemblyIds)
      .order("id", { ascending: true });

    if (componentError) {
      return fail(
        toUserError(componentError, "Failed to load recipe components"),
      );
    }

    const recipeNameById = new Map(
      recipesResult.data.map((recipe) => [recipe.id, recipe.name]),
    );
    const ingredientNameById = new Map(
      inventoryResult.data.map((item) => [item.id, item.name]),
    );
    const stockByIngredientId = new Map(
      inventoryResult.data.map((item) => [item.id, item.current_stock]),
    );
    const fgAvailableByProductId = new Map(
      fgResult.data.map((row) => [row.product_id, row.available_quantity]),
    );

    const bomLines: SaleableNowBomLine[] = (
      (componentData as RecipeComponentRow[] | null) ?? []
    ).map((row) => ({
      assembly_recipe_id: row.assembly_recipe_id,
      component_recipe_id: row.component_recipe_id,
      ingredient_id: row.ingredient_id,
      quantity: toNumber(row.quantity),
      component_name: row.component_recipe_id
        ? (recipeNameById.get(row.component_recipe_id) ?? null)
        : null,
      ingredient_name: row.ingredient_id
        ? (ingredientNameById.get(row.ingredient_id) ?? null)
        : null,
    }));

    return ok(
      computeMaxSaleableNow(
        products,
        bomLines,
        fgAvailableByProductId,
        stockByIngredientId,
      ),
    );
  } catch (error) {
    return fail(toUserError(error, "Failed to load saleable quantities"));
  }
}

export const saleableNowService = {
  listSaleableNow,
};
