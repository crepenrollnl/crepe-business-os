import { toUserError as mapServiceError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import type { ServiceResult } from "@/types/service";
import type {
  Recipe,
  RecipeFormValues,
  RecipeIngredientOption,
  RecipeItem,
  RecipeItemWithRelations,
  RecipeLineInput,
  RecipeListItem,
  RecipeWithRelations,
  SaveRecipeInput,
} from "../types/recipe";
import { isRecipeYieldUnit } from "../types/recipe";

const DUPLICATE_NAME_ERROR =
  "A recipe with this name already exists. Please choose a different name.";
const DUPLICATE_INGREDIENT_ERROR =
  "Each ingredient can only appear once in a recipe";

interface RecipeRow {
  id: string;
  name: string;
  description: string | null;
  yield_quantity: number | string;
  yield_unit: string;
  is_active: boolean;
  created_at: string;
  updated_at?: string;
}

interface RecipeItemRow {
  id: string;
  recipe_id: string;
  ingredient_id: string;
  quantity: number | string;
  unit: string;
}

function isDuplicateNameError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const code =
    "code" in error && typeof (error as { code: unknown }).code === "string"
      ? (error as { code: string }).code
      : "";
  const message =
    "message" in error &&
    typeof (error as { message: unknown }).message === "string"
      ? (error as { message: string }).message.toLowerCase()
      : "";

  return (
    code === "23505" &&
    (message.includes("recipes_name") ||
      (message.includes("duplicate") && message.includes("name")))
  );
}

function isDuplicateIngredientError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const code =
    "code" in error && typeof (error as { code: unknown }).code === "string"
      ? (error as { code: string }).code
      : "";
  const message =
    "message" in error &&
    typeof (error as { message: unknown }).message === "string"
      ? (error as { message: string }).message.toLowerCase()
      : "";

  return (
    code === "23505" &&
    (message.includes("recipe_items") ||
      message.includes("recipe_id") ||
      message.includes("ingredient_id"))
  );
}

function toUserError(error: unknown, fallback: string): string {
  return mapServiceError(error, fallback, {
    map: (value) => {
      if (isDuplicateNameError(value)) {
        return DUPLICATE_NAME_ERROR;
      }
      if (isDuplicateIngredientError(value)) {
        return DUPLICATE_INGREDIENT_ERROR;
      }
      return null;
    },
  });
}

function toNumber(value: number | string): number {
  return typeof value === "number" ? value : Number(value);
}

function mapRecipe(row: RecipeRow): Recipe {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    yield_quantity: toNumber(row.yield_quantity),
    yield_unit: row.yield_unit,
    is_active: row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapRecipeItem(row: RecipeItemRow): RecipeItem {
  return {
    id: row.id,
    recipe_id: row.recipe_id,
    ingredient_id: row.ingredient_id,
    quantity: toNumber(row.quantity),
    unit: row.unit,
  };
}

function validateLines(lines: RecipeLineInput[]): string | null {
  if (lines.length === 0) {
    return "Add at least one ingredient";
  }

  const seenIngredientIds = new Set<string>();

  for (const line of lines) {
    if (!line.ingredient_id.trim()) {
      return "Each line must have an ingredient";
    }

    if (seenIngredientIds.has(line.ingredient_id)) {
      return DUPLICATE_INGREDIENT_ERROR;
    }

    seenIngredientIds.add(line.ingredient_id);

    if (line.quantity === null) {
      return "Quantity is required";
    }

    if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
      return "Quantity must be greater than zero";
    }

    if (!line.unit.trim()) {
      return "Each line must have a unit";
    }
  }

  return null;
}

function validateRecipeInput(input: RecipeFormValues): string | null {
  if (!input.name.trim()) {
    return "Recipe name is required";
  }

  if (input.yield_quantity === null) {
    return "Yield quantity is required";
  }

  if (!Number.isFinite(input.yield_quantity) || input.yield_quantity <= 0) {
    return "Yield quantity must be greater than zero";
  }

  if (!isRecipeYieldUnit(input.yield_unit)) {
    return "Yield unit is required";
  }

  return validateLines(input.lines);
}

function toRecipePayload(input: RecipeFormValues) {
  if (input.yield_quantity === null) {
    throw new Error("Yield quantity is required");
  }

  return {
    name: input.name.trim(),
    description:
      input.description.trim().length > 0 ? input.description.trim() : null,
    yield_quantity: input.yield_quantity,
    yield_unit: input.yield_unit,
    is_active: input.is_active,
    updated_at: new Date().toISOString(),
  };
}

async function fetchIngredients(): Promise<
  ServiceResult<RecipeIngredientOption[]>
> {
  try {
    const { data, error } = await supabase
      .from("ingredients")
      .select("id, name, unit")
      .order("name");

    if (error) {
      return {
        data: null,
        error: toUserError(error, "Failed to load ingredients"),
      };
    }

    return { data: data ?? [], error: null };
  } catch (error) {
    return {
      data: null,
      error: toUserError(error, "Failed to load ingredients"),
    };
  }
}

async function replaceRecipeItems(
  recipeId: string,
  lines: RecipeLineInput[],
): Promise<ServiceResult<RecipeItem[]>> {
  const { error: deleteError } = await supabase
    .from("recipe_items")
    .delete()
    .eq("recipe_id", recipeId);

  if (deleteError) {
    return {
      data: null,
      error: toUserError(deleteError, "Failed to update recipe ingredients"),
    };
  }

  const { data, error } = await supabase
    .from("recipe_items")
    .insert(
      lines.map((line) => ({
        recipe_id: recipeId,
        ingredient_id: line.ingredient_id,
        quantity: line.quantity,
        unit: line.unit.trim(),
      })),
    )
    .select("*");

  if (error) {
    return {
      data: null,
      error: toUserError(error, "Failed to save recipe ingredients"),
    };
  }

  return {
    data: (data ?? []).map((row) => mapRecipeItem(row as RecipeItemRow)),
    error: null,
  };
}

async function enrichRecipe(
  recipe: Recipe,
  items: RecipeItem[],
): Promise<ServiceResult<RecipeWithRelations>> {
  const ingredientsResult = await fetchIngredients();

  if (ingredientsResult.error) {
    return { data: null, error: ingredientsResult.error };
  }

  const ingredientMap = new Map(
    (ingredientsResult.data ?? []).map((ingredient) => [
      ingredient.id,
      ingredient,
    ]),
  );

  const enrichedItems: RecipeItemWithRelations[] = items.map((item) => ({
    ...item,
    ingredient: ingredientMap.get(item.ingredient_id) ?? null,
  }));

  return {
    data: {
      ...recipe,
      items: enrichedItems,
    },
    error: null,
  };
}

async function persistRecipe(
  input: SaveRecipeInput,
): Promise<ServiceResult<RecipeWithRelations>> {
  const validationError = validateRecipeInput(input);

  if (validationError) {
    return { data: null, error: validationError };
  }

  const payload = toRecipePayload(input);
  const lines: RecipeLineInput[] = input.lines.map((line) => ({
    ingredient_id: line.ingredient_id,
    quantity: line.quantity as number,
    unit: line.unit.trim(),
  }));

  if (input.id) {
    const { data, error } = await supabase
      .from("recipes")
      .update(payload)
      .eq("id", input.id)
      .select("*")
      .single();

    if (error) {
      return {
        data: null,
        error: toUserError(error, "Failed to update recipe"),
      };
    }

    const itemsResult = await replaceRecipeItems(input.id, lines);

    if (itemsResult.error || !itemsResult.data) {
      return {
        data: null,
        error: itemsResult.error ?? "Failed to save recipe ingredients",
      };
    }

    return enrichRecipe(mapRecipe(data as RecipeRow), itemsResult.data);
  }

  const { data, error } = await supabase
    .from("recipes")
    .insert(payload)
    .select("*")
    .single();

  if (error) {
    return {
      data: null,
      error: toUserError(error, "Failed to create recipe"),
    };
  }

  const recipe = mapRecipe(data as RecipeRow);
  const itemsResult = await replaceRecipeItems(recipe.id, lines);

  if (itemsResult.error || !itemsResult.data) {
    await supabase.from("recipes").delete().eq("id", recipe.id);

    return {
      data: null,
      error: itemsResult.error ?? "Failed to save recipe ingredients",
    };
  }

  return enrichRecipe(recipe, itemsResult.data);
}

export const recipeService = {
  async getRecipes(): Promise<ServiceResult<RecipeListItem[]>> {
    try {
      const [recipesResult, itemsResult] = await Promise.all([
        supabase.from("recipes").select("*").order("name"),
        supabase.from("recipe_items").select("recipe_id"),
      ]);

      if (recipesResult.error) {
        return {
          data: null,
          error: toUserError(recipesResult.error, "Failed to load recipes"),
        };
      }

      if (itemsResult.error) {
        return {
          data: null,
          error: toUserError(
            itemsResult.error,
            "Failed to load recipe ingredients",
          ),
        };
      }

      const itemCountMap = new Map<string, number>();

      for (const item of itemsResult.data ?? []) {
        const recipeId = item.recipe_id as string;
        itemCountMap.set(recipeId, (itemCountMap.get(recipeId) ?? 0) + 1);
      }

      const recipes = (recipesResult.data ?? []).map((row) => {
        const recipe = mapRecipe(row as RecipeRow);

        return {
          ...recipe,
          item_count: itemCountMap.get(recipe.id) ?? 0,
        };
      });

      return { data: recipes, error: null };
    } catch (error) {
      return {
        data: null,
        error: toUserError(error, "Failed to load recipes"),
      };
    }
  },

  async getRecipe(id: string): Promise<ServiceResult<RecipeWithRelations>> {
    try {
      const { data, error } = await supabase
        .from("recipes")
        .select("*")
        .eq("id", id)
        .single();

      if (error) {
        return {
          data: null,
          error: toUserError(error, "Failed to load recipe"),
        };
      }

      const { data: itemsData, error: itemsError } = await supabase
        .from("recipe_items")
        .select("*")
        .eq("recipe_id", id);

      if (itemsError) {
        return {
          data: null,
          error: toUserError(itemsError, "Failed to load recipe ingredients"),
        };
      }

      const items = (itemsData ?? []).map((row) =>
        mapRecipeItem(row as RecipeItemRow),
      );

      return enrichRecipe(mapRecipe(data as RecipeRow), items);
    } catch (error) {
      return {
        data: null,
        error: toUserError(error, "Failed to load recipe"),
      };
    }
  },

  async getIngredients(): Promise<ServiceResult<RecipeIngredientOption[]>> {
    return fetchIngredients();
  },

  async createRecipe(
    input: RecipeFormValues,
  ): Promise<ServiceResult<RecipeWithRelations>> {
    try {
      return await persistRecipe(input);
    } catch (error) {
      return {
        data: null,
        error: toUserError(error, "Failed to create recipe"),
      };
    }
  },

  async updateRecipe(
    id: string,
    input: RecipeFormValues,
  ): Promise<ServiceResult<RecipeWithRelations>> {
    try {
      return await persistRecipe({ ...input, id });
    } catch (error) {
      return {
        data: null,
        error: toUserError(error, "Failed to update recipe"),
      };
    }
  },

  async deleteRecipe(id: string): Promise<ServiceResult<null>> {
    try {
      const { error } = await supabase.from("recipes").delete().eq("id", id);

      if (error) {
        return {
          data: null,
          error: toUserError(error, "Failed to delete recipe"),
        };
      }

      return { data: null, error: null };
    } catch (error) {
      return {
        data: null,
        error: toUserError(error, "Failed to delete recipe"),
      };
    }
  },
};
