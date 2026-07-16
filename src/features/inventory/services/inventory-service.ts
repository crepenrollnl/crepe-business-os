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
  const [categoriesResult, suppliersResult] = await Promise.all([
    supabase.from("ingredient_categories").select("id, name").order("name"),
    supabase.from("suppliers").select("id, name").order("name"),
  ]);

  if (categoriesResult.error) {
    return { data: null, error: categoriesResult.error.message };
  }

  if (suppliersResult.error) {
    return { data: null, error: suppliersResult.error.message };
  }

  return {
    data: {
      categories: categoriesResult.data ?? [],
      suppliers: suppliersResult.data ?? [],
    },
    error: null,
  };
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
    const referenceResult = getReferenceData(await fetchReferenceData());

    if ("error" in referenceResult) {
      return referenceResult;
    }

    const { data, error } = await supabase
      .from("ingredients")
      .select("*")
      .order("name");

    if (error) {
      return { data: null, error: error.message };
    }

    return {
      data: enrichIngredients(
        data ?? [],
        referenceResult.categories,
        referenceResult.suppliers,
      ),
      error: null,
    };
  },

  async getCategories(): Promise<ServiceResult<IngredientCategory[]>> {
    const { data, error } = await supabase
      .from("ingredient_categories")
      .select("id, name")
      .order("name");

    if (error) {
      return { data: null, error: error.message };
    }

    return { data: data ?? [], error: null };
  },

  async getSuppliers(): Promise<ServiceResult<Supplier[]>> {
    const { data, error } = await supabase
      .from("suppliers")
      .select("id, name")
      .order("name");

    if (error) {
      return { data: null, error: error.message };
    }

    return { data: data ?? [], error: null };
  },

  async createIngredient(
    input: CreateIngredientInput,
  ): Promise<ServiceResult<IngredientWithRelations>> {
    const referenceResult = getReferenceData(await fetchReferenceData());

    if ("error" in referenceResult) {
      return referenceResult;
    }

    const { data, error } = await supabase
      .from("ingredients")
      .insert(input)
      .select("*")
      .single();

    if (error) {
      return { data: null, error: error.message };
    }

    const [enriched] = enrichIngredients(
      [data],
      referenceResult.categories,
      referenceResult.suppliers,
    );

    return { data: enriched, error: null };
  },

  async updateIngredient(
    id: string,
    input: UpdateIngredientInput,
  ): Promise<ServiceResult<IngredientWithRelations>> {
    const referenceResult = getReferenceData(await fetchReferenceData());

    if ("error" in referenceResult) {
      return referenceResult;
    }

    const { data, error } = await supabase
      .from("ingredients")
      .update(input)
      .eq("id", id)
      .select("*")
      .single();

    if (error) {
      return { data: null, error: error.message };
    }

    const [enriched] = enrichIngredients(
      [data],
      referenceResult.categories,
      referenceResult.suppliers,
    );

    return { data: enriched, error: null };
  },

  async deleteIngredient(id: string): Promise<ServiceResult<null>> {
    const { error } = await supabase.from("ingredients").delete().eq("id", id);

    if (error) {
      return { data: null, error: error.message };
    }

    return { data: null, error: null };
  },
};
