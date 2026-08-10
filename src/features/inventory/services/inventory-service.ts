import {
  toUserError as mapServiceError,
  mapDeletionBlockedByReference,
  type DeletionBlockedMessages,
} from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import type { ServiceResult } from "@/types/service";
import type {
  CreateIngredientInput,
  Ingredient,
  IngredientCategory,
  IngredientWithRelations,
  Supplier,
  UpdateIngredientInput,
} from "../types/inventory";

const DUPLICATE_NAME_ERROR =
  "An ingredient with this name already exists. Please choose a different name.";

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
    code === "23505" ||
    (message.includes("duplicate") && message.includes("name")) ||
    message.includes("ingredients_name")
  );
}

const INGREDIENT_DELETE_BLOCKED_MESSAGES: DeletionBlockedMessages = {
  fallback:
    "This ingredient is used elsewhere in the system and cannot be deleted.",
  byTable: {
    purchase_items:
      "This ingredient is used in purchases and cannot be deleted.",
    recipe_items:
      "This ingredient is used in recipes and cannot be deleted.",
    production_plan_ingredients:
      "This ingredient is used in a production plan and cannot be deleted.",
    production_plan_shopping_items:
      "This ingredient is on a production plan's shopping list and cannot be deleted.",
    stock_movements:
      "This ingredient has stock movement history and cannot be deleted.",
  },
};

const mapIngredientDeletionBlocked = mapDeletionBlockedByReference(
  INGREDIENT_DELETE_BLOCKED_MESSAGES,
);

function toUserError(error: unknown, fallback: string): string {
  return mapServiceError(error, fallback, {
    map: (value) =>
      isDuplicateNameError(value)
        ? DUPLICATE_NAME_ERROR
        : mapIngredientDeletionBlocked(value),
  });
}

function unitChangeBlockedByRecipesError(usageCount: number): string {
  return `Cannot change unit: this ingredient is used in ${usageCount} recipe${
    usageCount === 1 ? "" : "s"
  }. Recipes lock in the unit when saved — remove the ingredient from those recipes first to change it.`;
}

async function countRecipeItemsForIngredient(
  ingredientId: string,
): Promise<ServiceResult<number>> {
  try {
    const { count, error } = await supabase
      .from("recipe_items")
      .select("id", { count: "exact", head: true })
      .eq("ingredient_id", ingredientId);

    if (error) {
      return {
        data: null,
        error: toUserError(error, "Failed to check recipe usage"),
      };
    }

    return { data: count ?? 0, error: null };
  } catch (error) {
    return {
      data: null,
      error: toUserError(error, "Failed to check recipe usage"),
    };
  }
}

/**
 * Unit is a free-text snapshot on recipe_items (no FK/CHECK to
 * ingredients.unit), copied only when a recipe line is created or its
 * ingredient re-selected. Changing an ingredient's unit after recipes
 * already reference it leaves those recipes silently stale, which can
 * later sum mismatched units during requirement aggregation. Block the
 * change at the source instead. recipe_components has no ingredient_id
 * column (it links recipe-to-recipe for the assembly layer), so only
 * recipe_items needs checking.
 */
async function validateUnitChange(
  id: string,
  requestedUnit: string,
): Promise<ServiceResult<true>> {
  try {
    const { data: current, error } = await supabase
      .from("ingredients")
      .select("unit")
      .eq("id", id)
      .single();

    if (error) {
      return {
        data: null,
        error: toUserError(error, "Failed to validate unit change"),
      };
    }

    if (current.unit === requestedUnit) {
      return { data: true, error: null };
    }

    const usageResult = await countRecipeItemsForIngredient(id);

    if (usageResult.error) {
      return { data: null, error: usageResult.error };
    }

    const usageCount = usageResult.data ?? 0;

    if (usageCount > 0) {
      return {
        data: null,
        error: unitChangeBlockedByRecipesError(usageCount),
      };
    }

    return { data: true, error: null };
  } catch (error) {
    return {
      data: null,
      error: toUserError(error, "Failed to validate unit change"),
    };
  }
}

async function findDuplicateName(
  name: string,
  excludeId?: string,
): Promise<ServiceResult<boolean>> {
  try {
    const normalizedName = name.trim().toLowerCase();

    if (normalizedName.length === 0) {
      return { data: false, error: null };
    }

    const { data, error } = await supabase
      .from("ingredients")
      .select("id, name");

    if (error) {
      return {
        data: null,
        error: toUserError(error, "Failed to validate ingredient name"),
      };
    }

    const hasDuplicate = (data ?? []).some((row) => {
      if (excludeId && row.id === excludeId) {
        return false;
      }

      return row.name.trim().toLowerCase() === normalizedName;
    });

    return { data: hasDuplicate, error: null };
  } catch (error) {
    return {
      data: null,
      error: toUserError(error, "Failed to validate ingredient name"),
    };
  }
}

function toIngredientPayload(input: CreateIngredientInput | UpdateIngredientInput) {
  return {
    name: input.name.trim(),
    category_id: input.category_id,
    supplier_id: input.supplier_id.trim().length > 0 ? input.supplier_id : null,
    unit: input.unit.trim(),
    current_stock: input.current_stock,
    minimum_stock: input.minimum_stock,
    cost_per_unit: input.cost_per_unit,
  };
}

function enrichIngredients(
  ingredients: Ingredient[],
  categories: IngredientCategory[],
  suppliers: Supplier[],
): IngredientWithRelations[] {
  const categoryMap = new Map(categories.map((category) => [category.id, category]));
  const supplierMap = new Map(suppliers.map((supplier) => [supplier.id, supplier]));

  return ingredients.map((ingredient) => ({
    ...ingredient,
    category: ingredient.category_id
      ? (categoryMap.get(ingredient.category_id) ?? null)
      : null,
    supplier: ingredient.supplier_id
      ? (supplierMap.get(ingredient.supplier_id) ?? null)
      : null,
  }));
}

async function fetchReferenceData(): Promise<
  ServiceResult<{ categories: IngredientCategory[]; suppliers: Supplier[] }>
> {
  try {
    const [categoriesResult, suppliersResult] = await Promise.all([
      supabase.from("ingredient_categories").select("id, name").order("name"),
      supabase.from("suppliers").select("id, name").order("name"),
    ]);

    if (categoriesResult.error) {
      return {
        data: null,
        error: toUserError(categoriesResult.error, "Failed to load categories"),
      };
    }

    if (suppliersResult.error) {
      return {
        data: null,
        error: toUserError(suppliersResult.error, "Failed to load suppliers"),
      };
    }

    return {
      data: {
        categories: categoriesResult.data ?? [],
        suppliers: suppliersResult.data ?? [],
      },
      error: null,
    };
  } catch (error) {
    return {
      data: null,
      error: toUserError(error, "Failed to load reference data"),
    };
  }
}

function getReferenceData(
  result: ServiceResult<{ categories: IngredientCategory[]; suppliers: Supplier[] }>,
): { categories: IngredientCategory[]; suppliers: Supplier[] } | ServiceResult<never> {
  if (result.error || !result.data) {
    return { data: null, error: result.error ?? "Failed to load reference data" };
  }

  return result.data;
}

export const inventoryService = {
  async getInventory(): Promise<ServiceResult<IngredientWithRelations[]>> {
    try {
      const referenceResult = getReferenceData(await fetchReferenceData());

      if ("error" in referenceResult) {
        return referenceResult;
      }

      const { data, error } = await supabase
        .from("ingredients")
        .select("*")
        .order("name");

      if (error) {
        return {
          data: null,
          error: toUserError(error, "Failed to load inventory"),
        };
      }

      return {
        data: enrichIngredients(
          data ?? [],
          referenceResult.categories,
          referenceResult.suppliers,
        ),
        error: null,
      };
    } catch (error) {
      return {
        data: null,
        error: toUserError(error, "Failed to load inventory"),
      };
    }
  },

  async getCategories(): Promise<ServiceResult<IngredientCategory[]>> {
    try {
      const { data, error } = await supabase
        .from("ingredient_categories")
        .select("id, name")
        .order("name");

      if (error) {
        return {
          data: null,
          error: toUserError(error, "Failed to load categories"),
        };
      }

      return { data: data ?? [], error: null };
    } catch (error) {
      return {
        data: null,
        error: toUserError(error, "Failed to load categories"),
      };
    }
  },

  async getSuppliers(): Promise<ServiceResult<Supplier[]>> {
    try {
      const { data, error } = await supabase
        .from("suppliers")
        .select("id, name")
        .order("name");

      if (error) {
        return {
          data: null,
          error: toUserError(error, "Failed to load suppliers"),
        };
      }

      return { data: data ?? [], error: null };
    } catch (error) {
      return {
        data: null,
        error: toUserError(error, "Failed to load suppliers"),
      };
    }
  },

  async createIngredient(
    input: CreateIngredientInput,
  ): Promise<ServiceResult<IngredientWithRelations>> {
    try {
      const duplicateResult = await findDuplicateName(input.name);

      if (duplicateResult.error) {
        return { data: null, error: duplicateResult.error };
      }

      if (duplicateResult.data) {
        return { data: null, error: DUPLICATE_NAME_ERROR };
      }

      const referenceResult = getReferenceData(await fetchReferenceData());

      if ("error" in referenceResult) {
        return referenceResult;
      }

      const { data, error } = await supabase
        .from("ingredients")
        .insert(toIngredientPayload(input))
        .select("*")
        .single();

      if (error) {
        return {
          data: null,
          error: toUserError(error, "Failed to create ingredient"),
        };
      }

      const [enriched] = enrichIngredients(
        [data],
        referenceResult.categories,
        referenceResult.suppliers,
      );

      return { data: enriched, error: null };
    } catch (error) {
      return {
        data: null,
        error: toUserError(error, "Failed to create ingredient"),
      };
    }
  },

  async updateIngredient(
    id: string,
    input: UpdateIngredientInput,
  ): Promise<ServiceResult<IngredientWithRelations>> {
    try {
      const duplicateResult = await findDuplicateName(input.name, id);

      if (duplicateResult.error) {
        return { data: null, error: duplicateResult.error };
      }

      if (duplicateResult.data) {
        return { data: null, error: DUPLICATE_NAME_ERROR };
      }

      const unitChangeResult = await validateUnitChange(id, input.unit.trim());

      if (unitChangeResult.error) {
        return { data: null, error: unitChangeResult.error };
      }

      const referenceResult = getReferenceData(await fetchReferenceData());

      if ("error" in referenceResult) {
        return referenceResult;
      }

      const { data, error } = await supabase
        .from("ingredients")
        .update(toIngredientPayload(input))
        .eq("id", id)
        .select("*")
        .single();

      if (error) {
        return {
          data: null,
          error: toUserError(error, "Failed to update ingredient"),
        };
      }

      const [enriched] = enrichIngredients(
        [data],
        referenceResult.categories,
        referenceResult.suppliers,
      );

      return { data: enriched, error: null };
    } catch (error) {
      return {
        data: null,
        error: toUserError(error, "Failed to update ingredient"),
      };
    }
  },

  /**
   * Number of recipe_items rows referencing this ingredient — used by the
   * edit form to lock the Unit field before the user hits an error on save,
   * not just as a save-time guard.
   */
  async getIngredientRecipeUsageCount(
    id: string,
  ): Promise<ServiceResult<number>> {
    return countRecipeItemsForIngredient(id);
  },

  async deleteIngredient(id: string): Promise<ServiceResult<null>> {
    try {
      const { error } = await supabase.from("ingredients").delete().eq("id", id);

      if (error) {
        return {
          data: null,
          error: toUserError(error, "Failed to delete ingredient"),
        };
      }

      return { data: null, error: null };
    } catch (error) {
      return {
        data: null,
        error: toUserError(error, "Failed to delete ingredient"),
      };
    }
  },
};
