import {
  calculateProductionPlan,
  generateProcurementRecommendation,
  generateShoppingList,
  type PlanValidationIssue,
  type PlanningInventoryItem,
  type PlanningRecipe,
  type PlanningRecipeIngredientLine,
  type ProductionPlan as DomainProductionPlan,
  type ProductionPlanLine,
} from "@/features/production-planning";
import { purchaseService } from "@/features/purchases/services/purchase-service";
import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import type { ServiceResult } from "@/types/service";
import type {
  AddProductionPlanProductInput,
  CreateProductionPlanInput,
  ProductionIngredientRequirement,
  ProductionPlan,
  ProductionPlanCalculationResult,
  ProductionPlanFormValues,
  ProductionPlanIngredient,
  ProductionPlanLinkedPurchase,
  ProductionPlanListItem,
  ProductionPlanProduct,
  ProductionPlanProductLineInput,
  ProductionPlanProductStatus,
  ProductionPlanShoppingItem,
  ProductionPlanStatus,
  ProductionPlanSummary,
  ProductionPlanWithRelations,
  ProductionRecipeOption,
  ProductionRequirementPreview,
  PurchaseDraftLinkStatus,
  ShoppingListStatus,
  UpdateProductionPlanProductQuantityInput,
} from "../types/production";
import { getCreateProductionPlanValidationMessage } from "../utils/validate-create-production-plan";
import { mapPlanCalculationResult } from "../utils/map-plan-calculation-result";
import {
  getAddPlanProductValidationMessage,
  getUpdatePlanProductQuantityValidationMessage,
} from "../utils/validate-plan-product";

const DUPLICATE_PURCHASE_DRAFT_ERROR = "Already transferred.";
const EMPTY_PURCHASE_DRAFT_ERROR =
  "Purchase Draft is empty. All required ingredients are available.";
const MISSING_PURCHASE_DRAFT_LINES_ERROR =
  "Calculate requirements before sending a Purchase Draft to Purchases.";
const DUPLICATE_PLAN_PRODUCT_ERROR =
  "This finished good is already on the plan.";
const RECIPE_REQUIRED_ERROR = "Recipe must exist for the selected product.";
const ARCHIVED_PRODUCT_ERROR =
  "Archived products cannot be added to a production plan.";
const PLAN_LOCKED_ERROR =
  "Products cannot be changed for this production plan status.";

interface ProductionPlanRow {
  id: string;
  plan_number: number | string;
  name: string | null;
  status: ProductionPlanStatus;
  planning_date: string;
  notes: string | null;
  shopping_list_generated_at: string | null;
  created_at: string;
  updated_at?: string;
}

interface ProductionPlanProductRow {
  id: string;
  production_plan_id: string;
  recipe_id: string;
  recipe_name: string;
  planned_quantity: number | string;
  yield_quantity: number | string;
  yield_unit: string;
  sort_order: number | string;
}

interface ProductionPlanIngredientRow {
  id: string;
  production_plan_id: string;
  ingredient_id: string;
  ingredient_name: string;
  unit: string;
  required_quantity: number | string;
  inventory_quantity_at_planning: number | string;
  missing_quantity: number | string;
}

interface ProductionPlanShoppingItemRow {
  id: string;
  production_plan_id: string;
  ingredient_id: string;
  ingredient_name: string;
  quantity: number | string;
  unit: string;
}

interface RecipeRow {
  id: string;
  name: string;
  yield_quantity: number | string;
  yield_unit: string;
  is_active: boolean;
}

interface RecipeItemRow {
  recipe_id: string;
  ingredient_id: string;
  quantity: number | string;
  unit: string;
}

interface IngredientStockRow {
  id: string;
  name: string;
  unit: string;
  current_stock: number | string;
}

interface PurchaseLinkRow {
  id: string;
  status: "draft" | "received" | "cancelled";
  invoice_number: string | null;
  production_plan_id: string;
}

function toNumber(value: number | string): number {
  return typeof value === "number" ? value : Number(value);
}

function roundQuantity(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function mapRecipeOption(row: RecipeRow): ProductionRecipeOption {
  return {
    id: row.id,
    name: row.name,
    yield_quantity: toNumber(row.yield_quantity),
    yield_unit: row.yield_unit,
    is_active: row.is_active,
  };
}

function mapPlan(row: ProductionPlanRow): ProductionPlan {
  const planNumber = toNumber(row.plan_number);
  const trimmedName = row.name?.trim() ?? "";

  return {
    id: row.id,
    plan_number: planNumber,
    name: trimmedName.length > 0 ? trimmedName : `Plan #${planNumber}`,
    status: row.status,
    planning_date: row.planning_date,
    notes: row.notes,
    shopping_list_generated_at: row.shopping_list_generated_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapProduct(
  row: ProductionPlanProductRow,
  status: ProductionPlanProductStatus = "active",
): ProductionPlanProduct {
  return {
    id: row.id,
    production_plan_id: row.production_plan_id,
    recipe_id: row.recipe_id,
    recipe_name: row.recipe_name,
    planned_quantity: toNumber(row.planned_quantity),
    yield_quantity: toNumber(row.yield_quantity),
    yield_unit: row.yield_unit,
    sort_order: toNumber(row.sort_order),
    status,
  };
}

function isPlanEditable(status: ProductionPlanStatus): boolean {
  return (
    status !== "completed" &&
    status !== "cancelled"
  );
}

async function resolveProductStatuses(
  products: ProductionPlanProductRow[],
): Promise<ServiceResult<Map<string, ProductionPlanProductStatus>>> {
  const statusByRecipeId = new Map<string, ProductionPlanProductStatus>();

  if (products.length === 0) {
    return { data: statusByRecipeId, error: null };
  }

  const recipeIds = [...new Set(products.map((product) => product.recipe_id))];
  const { data, error } = await supabase
    .from("recipes")
    .select("id, is_active")
    .in("id", recipeIds);

  if (error) {
    return {
      data: null,
      error: toUserError(error, "Failed to load recipe status"),
    };
  }

  for (const row of (data ?? []) as Array<{ id: string; is_active: boolean }>) {
    statusByRecipeId.set(row.id, row.is_active ? "active" : "inactive");
  }

  for (const product of products) {
    if (!statusByRecipeId.has(product.recipe_id)) {
      statusByRecipeId.set(product.recipe_id, "inactive");
    }
  }

  return { data: statusByRecipeId, error: null };
}

function mapIngredient(
  row: ProductionPlanIngredientRow,
): ProductionPlanIngredient {
  return {
    id: row.id,
    production_plan_id: row.production_plan_id,
    ingredient_id: row.ingredient_id,
    ingredient_name: row.ingredient_name,
    unit: row.unit,
    required_quantity: toNumber(row.required_quantity),
    inventory_quantity_at_planning: toNumber(row.inventory_quantity_at_planning),
    missing_quantity: toNumber(row.missing_quantity),
  };
}

function mapShoppingItem(
  row: ProductionPlanShoppingItemRow,
): ProductionPlanShoppingItem {
  return {
    id: row.id,
    production_plan_id: row.production_plan_id,
    ingredient_id: row.ingredient_id,
    ingredient_name: row.ingredient_name,
    quantity: toNumber(row.quantity),
    unit: row.unit,
  };
}

function shoppingListStatus(
  shoppingListGeneratedAt: string | null,
): ShoppingListStatus {
  return shoppingListGeneratedAt ? "generated" : "not_generated";
}

function purchaseDraftStatus(
  purchase: ProductionPlanLinkedPurchase | null,
): PurchaseDraftLinkStatus {
  if (!purchase || purchase.status === "cancelled") {
    return "not_created";
  }

  if (purchase.status === "received") {
    return "completed";
  }

  return "draft_created";
}

function buildSummary(
  plan: ProductionPlan,
  products: ProductionPlanProduct[],
  ingredients: ProductionPlanIngredient[],
  purchase: ProductionPlanLinkedPurchase | null,
): ProductionPlanSummary {
  return {
    planned_product_count: products.length,
    total_ingredient_lines: ingredients.length,
    missing_ingredient_lines: ingredients.filter(
      (line) => line.missing_quantity > 0,
    ).length,
    shopping_list_status: shoppingListStatus(plan.shopping_list_generated_at),
    purchase_draft_status: purchaseDraftStatus(purchase),
    planning_status: plan.status,
  };
}

function validatePlanInput(input: ProductionPlanFormValues): string | null {
  return getCreateProductionPlanValidationMessage(input);
}

async function fetchIngredientStock(
  ingredientIds: string[],
): Promise<ServiceResult<IngredientStockRow[]>> {
  if (ingredientIds.length === 0) {
    return { data: [], error: null };
  }

  const { data, error } = await supabase
    .from("ingredients")
    .select("id, name, unit, current_stock")
    .in("id", ingredientIds);

  if (error) {
    return {
      data: null,
      error: toUserError(error, "Failed to load ingredient stock"),
    };
  }

  return { data: (data ?? []) as IngredientStockRow[], error: null };
}

async function buildLiveRequirements(
  products: ProductionPlanProductLineInput[],
): Promise<ServiceResult<ProductionRequirementPreview>> {
  const prepared = products.filter(
    (product) =>
      product.recipe_id &&
      product.planned_quantity !== null &&
      product.planned_quantity > 0,
  );

  if (prepared.length === 0) {
    return {
      data: {
        lines: [],
        is_inventory_sufficient: true,
        missing_line_count: 0,
      },
      error: null,
    };
  }

  const recipeIds = prepared.map((product) => product.recipe_id);

  const [recipesResult, itemsResult] = await Promise.all([
    supabase
      .from("recipes")
      .select("id, name, yield_quantity, yield_unit, is_active")
      .in("id", recipeIds),
    supabase
      .from("recipe_items")
      .select("recipe_id, ingredient_id, quantity, unit")
      .in("recipe_id", recipeIds),
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
      error: toUserError(itemsResult.error, "Failed to load recipe ingredients"),
    };
  }

  const recipeMap = new Map(
    ((recipesResult.data ?? []) as RecipeRow[]).map((row) => [
      row.id,
      mapRecipeOption(row),
    ]),
  );

  const requiredByIngredient = new Map<
    string,
    { quantity: number; unit: string }
  >();

  for (const product of prepared) {
    const recipe = recipeMap.get(product.recipe_id);

    if (!recipe) {
      return { data: null, error: "One or more selected recipes were not found" };
    }

    if (!recipe.is_active) {
      return {
        data: null,
        error: `Recipe "${recipe.name}" is inactive`,
      };
    }

    if (recipe.yield_quantity <= 0) {
      return {
        data: null,
        error: `Recipe "${recipe.name}" has an invalid yield`,
      };
    }

    const plannedQuantity = product.planned_quantity as number;
    const scale = plannedQuantity / recipe.yield_quantity;
    const recipeItems = ((itemsResult.data ?? []) as RecipeItemRow[]).filter(
      (item) => item.recipe_id === product.recipe_id,
    );

    if (recipeItems.length === 0) {
      return {
        data: null,
        error: `Recipe "${recipe.name}" has no ingredients`,
      };
    }

    for (const item of recipeItems) {
      const required = roundQuantity(toNumber(item.quantity) * scale);
      const existing = requiredByIngredient.get(item.ingredient_id);

      if (existing) {
        existing.quantity = roundQuantity(existing.quantity + required);
      } else {
        requiredByIngredient.set(item.ingredient_id, {
          quantity: required,
          unit: item.unit,
        });
      }
    }
  }

  const ingredientIds = [...requiredByIngredient.keys()];
  const stockResult = await fetchIngredientStock(ingredientIds);

  if (stockResult.error || !stockResult.data) {
    return {
      data: null,
      error: stockResult.error ?? "Failed to load ingredient stock",
    };
  }

  const stockMap = new Map(
    stockResult.data.map((ingredient) => [ingredient.id, ingredient]),
  );

  const lines: ProductionIngredientRequirement[] = ingredientIds.map(
    (ingredientId) => {
      const required = requiredByIngredient.get(ingredientId)!;
      const ingredient = stockMap.get(ingredientId);
      const currentStock = ingredient
        ? roundQuantity(toNumber(ingredient.current_stock))
        : 0;
      const missingQuantity = roundQuantity(
        Math.max(0, required.quantity - currentStock),
      );

      return {
        ingredient_id: ingredientId,
        ingredient_name: ingredient?.name ?? "Unknown ingredient",
        unit: ingredient?.unit ?? required.unit,
        required_quantity: required.quantity,
        current_stock: currentStock,
        missing_quantity: missingQuantity,
        is_sufficient: missingQuantity <= 0,
      };
    },
  );

  lines.sort((a, b) => a.ingredient_name.localeCompare(b.ingredient_name));

  const missingLineCount = lines.filter((line) => !line.is_sufficient).length;

  return {
    data: {
      lines,
      is_inventory_sufficient: missingLineCount === 0,
      missing_line_count: missingLineCount,
    },
    error: null,
  };
}

function formatPlanValidationIssues(
  issues: readonly PlanValidationIssue[],
): string {
  const first = issues[0];
  if (!first) {
    return "Failed to calculate requirements";
  }

  if (issues.length === 1) {
    return first.message;
  }

  return `${first.message} (${issues.length - 1} more issue${
    issues.length === 2 ? "" : "s"
  })`;
}

function toDomainPlan(plan: ProductionPlan): DomainProductionPlan {
  return {
    id: plan.id,
    name: plan.name,
    status: "draft",
    plannedDate: plan.planning_date,
    notes: plan.notes,
    createdAt: plan.created_at,
    updatedAt: plan.updated_at ?? plan.created_at,
  };
}

function toDomainPlanLines(
  products: ProductionPlanProduct[],
): ProductionPlanLine[] {
  return products.map((product) => ({
    finishedGoodId: product.recipe_id,
    recipeId: product.recipe_id,
    plannedQuantity: product.planned_quantity,
    unit: product.yield_unit,
  }));
}

/**
 * Runs the domain calculation pipeline for a loaded plan.
 * Read-only: never mutates inventory, purchases, or production batches.
 */
async function runDomainPlanCalculation(
  plan: ProductionPlan,
  products: ProductionPlanProduct[],
): Promise<ServiceResult<ProductionPlanCalculationResult>> {
  if (products.length === 0) {
    return {
      data: null,
      error: "Add at least one product before calculating requirements",
    };
  }

  const recipeIds = products.map((product) => product.recipe_id);

  const [recipesResult, itemsResult] = await Promise.all([
    supabase
      .from("recipes")
      .select("id, name, yield_quantity, yield_unit, is_active")
      .in("id", recipeIds),
    supabase
      .from("recipe_items")
      .select("recipe_id, ingredient_id, quantity, unit")
      .in("recipe_id", recipeIds),
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
      error: toUserError(itemsResult.error, "Failed to load recipe ingredients"),
    };
  }

  const recipeRows = (recipesResult.data ?? []) as RecipeRow[];
  const itemRows = (itemsResult.data ?? []) as RecipeItemRow[];

  const recipes: PlanningRecipe[] = recipeRows.map((row) => ({
    id: row.id,
    finishedGoodId: row.id,
    status: row.is_active ? "active" : "inactive",
    yieldQuantity: toNumber(row.yield_quantity),
    yieldUnit: row.yield_unit,
  }));

  const recipeIngredients: PlanningRecipeIngredientLine[] = itemRows.map(
    (row) => ({
      recipeId: row.recipe_id,
      ingredientId: row.ingredient_id,
      quantityPerYield: toNumber(row.quantity),
      unit: row.unit,
    }),
  );

  const recipeNameById = new Map(recipeRows.map((row) => [row.id, row.name]));
  const ingredientsByRecipeId = new Map<string, number>();
  for (const item of recipeIngredients) {
    ingredientsByRecipeId.set(
      item.recipeId,
      (ingredientsByRecipeId.get(item.recipeId) ?? 0) + 1,
    );
  }

  for (const product of products) {
    if ((ingredientsByRecipeId.get(product.recipe_id) ?? 0) === 0) {
      const recipeName =
        recipeNameById.get(product.recipe_id) ?? product.recipe_name;
      return {
        data: null,
        error: `Recipe "${recipeName}" has no ingredients`,
      };
    }
  }

  const ingredientIds = [
    ...new Set(recipeIngredients.map((item) => item.ingredientId)),
  ];
  const stockResult = await fetchIngredientStock(ingredientIds);

  if (stockResult.error || !stockResult.data) {
    return {
      data: null,
      error: stockResult.error ?? "Failed to load ingredient stock",
    };
  }

  const stockById = new Map(
    stockResult.data.map((ingredient) => [ingredient.id, ingredient]),
  );

  const inventory: PlanningInventoryItem[] = ingredientIds.map(
    (ingredientId) => {
      const stock = stockById.get(ingredientId);
      return {
        ingredientId,
        availableQuantity: stock
          ? roundQuantity(toNumber(stock.current_stock))
          : 0,
        ingredientName: stock?.name,
      };
    },
  );

  const calculation = calculateProductionPlan({
    plan: toDomainPlan(plan),
    lines: toDomainPlanLines(products),
    recipes,
    recipeIngredients,
    inventory,
  });

  if (!calculation.ok) {
    return {
      data: null,
      error: formatPlanValidationIssues(calculation.issues),
    };
  }

  const shopping = generateShoppingList(calculation.result);
  if (!shopping.ok) {
    return {
      data: null,
      error: formatPlanValidationIssues(shopping.issues),
    };
  }

  const procurement = generateProcurementRecommendation({
    shoppingList: shopping.shoppingList,
  });

  if (!procurement.ok) {
    return {
      data: null,
      error: formatPlanValidationIssues(procurement.issues),
    };
  }

  return {
    data: mapPlanCalculationResult(
      calculation.result,
      shopping.shoppingList,
      procurement.recommendation,
    ),
    error: null,
  };
}

async function fetchLinkedPurchases(
  planIds: string[],
): Promise<ServiceResult<Map<string, ProductionPlanLinkedPurchase>>> {
  if (planIds.length === 0) {
    return { data: new Map(), error: null };
  }

  const { data, error } = await supabase
    .from("purchases")
    .select("id, status, invoice_number, production_plan_id")
    .in("production_plan_id", planIds);

  if (error) {
    return {
      data: null,
      error: toUserError(error, "Failed to load linked purchases"),
    };
  }

  const map = new Map<string, ProductionPlanLinkedPurchase>();

  for (const row of (data ?? []) as PurchaseLinkRow[]) {
    if (!row.production_plan_id || row.status === "cancelled") {
      continue;
    }

    map.set(row.production_plan_id, {
      id: row.id,
      status: row.status,
      invoice_number: row.invoice_number,
    });
  }

  return { data: map, error: null };
}

async function loadPlanRelations(
  planId: string,
): Promise<
  ServiceResult<{
    products: ProductionPlanProduct[];
    ingredients: ProductionPlanIngredient[];
    shoppingItems: ProductionPlanShoppingItem[];
    linkedPurchase: ProductionPlanLinkedPurchase | null;
  }>
> {
  const [productsResult, ingredientsResult, shoppingResult, purchaseResult] =
    await Promise.all([
      supabase
        .from("production_plan_products")
        .select("*")
        .eq("production_plan_id", planId)
        .order("sort_order"),
      supabase
        .from("production_plan_ingredients")
        .select("*")
        .eq("production_plan_id", planId)
        .order("ingredient_name"),
      supabase
        .from("production_plan_shopping_items")
        .select("*")
        .eq("production_plan_id", planId)
        .order("ingredient_name"),
      fetchLinkedPurchases([planId]),
    ]);

  if (productsResult.error) {
    return {
      data: null,
      error: toUserError(productsResult.error, "Failed to load plan products"),
    };
  }

  if (ingredientsResult.error) {
    return {
      data: null,
      error: toUserError(
        ingredientsResult.error,
        "Failed to load plan ingredients",
      ),
    };
  }

  if (shoppingResult.error) {
    return {
      data: null,
      error: toUserError(shoppingResult.error, "Failed to load shopping list"),
    };
  }

  if (purchaseResult.error || !purchaseResult.data) {
    return {
      data: null,
      error: purchaseResult.error ?? "Failed to load linked purchases",
    };
  }

  const productRows =
    (productsResult.data ?? []) as ProductionPlanProductRow[];
  const statusResult = await resolveProductStatuses(productRows);

  if (statusResult.error || !statusResult.data) {
    return {
      data: null,
      error: statusResult.error ?? "Failed to load recipe status",
    };
  }

  return {
    data: {
      products: productRows.map((row) =>
        mapProduct(row, statusResult.data.get(row.recipe_id) ?? "inactive"),
      ),
      ingredients: (
        (ingredientsResult.data ?? []) as ProductionPlanIngredientRow[]
      ).map(mapIngredient),
      shoppingItems: (
        (shoppingResult.data ?? []) as ProductionPlanShoppingItemRow[]
      ).map(mapShoppingItem),
      linkedPurchase: purchaseResult.data.get(planId) ?? null,
    },
    error: null,
  };
}

function enrichPlan(
  plan: ProductionPlan,
  relations: {
    products: ProductionPlanProduct[];
    ingredients: ProductionPlanIngredient[];
    shoppingItems: ProductionPlanShoppingItem[];
    linkedPurchase: ProductionPlanLinkedPurchase | null;
  },
): ProductionPlanWithRelations {
  const purchaseDraft = purchaseDraftStatus(relations.linkedPurchase);
  const shoppingStatus = shoppingListStatus(plan.shopping_list_generated_at);

  return {
    ...plan,
    products: relations.products,
    ingredients: relations.ingredients,
    shopping_items: relations.shoppingItems,
    linked_purchase: relations.linkedPurchase,
    purchase_draft_status: purchaseDraft,
    shopping_list_status: shoppingStatus,
    summary: buildSummary(
      plan,
      relations.products,
      relations.ingredients,
      relations.linkedPurchase,
    ),
  };
}

/**
 * Checks live ingredient sufficiency and transitions the plan to
 * ready_to_produce atomically on the server (check_production_plan_readiness).
 * Requirements and current stock are read fresh inside that RPC, under a
 * row lock on the plan, instead of relying on client-loaded snapshots.
 */
async function maybeMarkReadyToProduce(
  plan: ProductionPlan,
): Promise<ServiceResult<ProductionPlan>> {
  if (
    plan.status === "completed" ||
    plan.status === "cancelled" ||
    plan.status === "ready_to_produce"
  ) {
    return { data: plan, error: null };
  }

  const { data, error } = await supabase.rpc(
    "check_production_plan_readiness",
    { p_plan_id: plan.id },
  );

  if (error) {
    return {
      data: null,
      error: toUserError(error, "Failed to update production plan status"),
    };
  }

  if (!data) {
    return {
      data: null,
      error: "Failed to update production plan status",
    };
  }

  return { data: mapPlan(data as ProductionPlanRow), error: null };
}

export const productionService = {
  async getRecipeOptions(): Promise<ServiceResult<ProductionRecipeOption[]>> {
    try {
      // Only pre-produced components are planned/produced ahead of time —
      // assembly dishes are built from components at sale time and are
      // never selectable here (Critical Finding #4).
      const { data, error } = await supabase
        .from("recipes")
        .select("id, name, yield_quantity, yield_unit, is_active")
        .eq("is_active", true)
        .eq("recipe_role", "component")
        .order("name");

      if (error) {
        return {
          data: null,
          error: toUserError(error, "Failed to load recipes"),
        };
      }

      return {
        data: ((data ?? []) as RecipeRow[]).map(mapRecipeOption),
        error: null,
      };
    } catch (error) {
      return {
        data: null,
        error: toUserError(error, "Failed to load recipes"),
      };
    }
  },

  async calculateRequirements(
    products: ProductionPlanProductLineInput[],
  ): Promise<ServiceResult<ProductionRequirementPreview>> {
    try {
      return await buildLiveRequirements(products);
    } catch (error) {
      return {
        data: null,
        error: toUserError(error, "Failed to calculate requirements"),
      };
    }
  },

  /**
   * Calculate Requirements workspace pipeline:
   * Calculation Engine → Shopping List → Procurement Recommendation.
   *
   * Results are returned for on-page display only.
   * Does not mutate inventory, create purchases, or start production.
   */
  async calculatePlanRequirements(
    planId: string,
  ): Promise<ServiceResult<ProductionPlanCalculationResult>> {
    try {
      const planResult = await this.getProductionPlanById(planId);

      if (planResult.error || !planResult.data) {
        return {
          data: null,
          error: planResult.error ?? "Failed to load production plan",
        };
      }

      return await runDomainPlanCalculation(
        planResult.data,
        planResult.data.products,
      );
    } catch (error) {
      return {
        data: null,
        error: toUserError(error, "Failed to calculate requirements"),
      };
    }
  },

  async getProductionPlans(): Promise<ServiceResult<ProductionPlanListItem[]>> {
    try {
      const { data, error } = await supabase
        .from("production_plans")
        .select("*")
        .order("planning_date", { ascending: false });

      if (error) {
        return {
          data: null,
          error: toUserError(error, "Failed to load production plans"),
        };
      }

      const plans = ((data ?? []) as ProductionPlanRow[]).map(mapPlan);
      const planIds = plans.map((plan) => plan.id);

      const [productsResult, ingredientsResult, purchasesResult] =
        await Promise.all([
          planIds.length === 0
            ? Promise.resolve({ data: [], error: null })
            : supabase
                .from("production_plan_products")
                .select("production_plan_id")
                .in("production_plan_id", planIds),
          planIds.length === 0
            ? Promise.resolve({ data: [], error: null })
            : supabase
                .from("production_plan_ingredients")
                .select("production_plan_id, missing_quantity")
                .in("production_plan_id", planIds),
          fetchLinkedPurchases(planIds),
        ]);

      if (productsResult.error) {
        return {
          data: null,
          error: toUserError(productsResult.error, "Failed to load plan products"),
        };
      }

      if (ingredientsResult.error) {
        return {
          data: null,
          error: toUserError(
            ingredientsResult.error,
            "Failed to load plan ingredients",
          ),
        };
      }

      if (purchasesResult.error || !purchasesResult.data) {
        return {
          data: null,
          error: purchasesResult.error ?? "Failed to load linked purchases",
        };
      }

      const productCountMap = new Map<string, number>();
      for (const row of productsResult.data ?? []) {
        const planId = row.production_plan_id as string;
        productCountMap.set(planId, (productCountMap.get(planId) ?? 0) + 1);
      }

      const missingCountMap = new Map<string, number>();
      for (const row of ingredientsResult.data ?? []) {
        const planId = row.production_plan_id as string;
        const missing = toNumber(row.missing_quantity as number | string);
        if (missing > 0) {
          missingCountMap.set(planId, (missingCountMap.get(planId) ?? 0) + 1);
        }
      }

      const listItems: ProductionPlanListItem[] = [];

      for (const plan of plans) {
        let currentPlan = plan;
        const linkedPurchase = purchasesResult.data.get(plan.id) ?? null;

        if (
          plan.status === "planned" ||
          plan.status === "waiting_for_purchases"
        ) {
          const readiness = await maybeMarkReadyToProduce(plan);

          if (readiness.data) {
            currentPlan = readiness.data;
          }
        }

        listItems.push({
          ...currentPlan,
          product_count: productCountMap.get(plan.id) ?? 0,
          missing_ingredient_lines: missingCountMap.get(plan.id) ?? 0,
          shopping_list_status: shoppingListStatus(
            currentPlan.shopping_list_generated_at,
          ),
          purchase_draft_status: purchaseDraftStatus(linkedPurchase),
          linked_purchase: linkedPurchase,
        });
      }

      return { data: listItems, error: null };
    } catch (error) {
      return {
        data: null,
        error: toUserError(error, "Failed to load production plans"),
      };
    }
  },

  async getProductionPlanById(
    id: string,
  ): Promise<ServiceResult<ProductionPlanWithRelations>> {
    try {
      const { data, error } = await supabase
        .from("production_plans")
        .select("*")
        .eq("id", id)
        .single();

      if (error) {
        return {
          data: null,
          error: toUserError(error, "Failed to load production plan"),
        };
      }

      let plan = mapPlan(data as ProductionPlanRow);
      const relationsResult = await loadPlanRelations(id);

      if (relationsResult.error || !relationsResult.data) {
        return {
          data: null,
          error: relationsResult.error ?? "Failed to load production plan",
        };
      }

      if (
        plan.status === "planned" ||
        plan.status === "waiting_for_purchases"
      ) {
        const readiness = await maybeMarkReadyToProduce(plan);

        if (readiness.error || !readiness.data) {
          return {
            data: null,
            error: readiness.error ?? "Failed to update production plan status",
          };
        }

        plan = readiness.data;
      }

      return {
        data: enrichPlan(plan, relationsResult.data),
        error: null,
      };
    } catch (error) {
      return {
        data: null,
        error: toUserError(error, "Failed to load production plan"),
      };
    }
  },

  /**
   * Creates a Draft production plan (header only).
   * Does not change inventory. Products / requirements come in later steps.
   */
  async createProductionPlan(
    input: CreateProductionPlanInput,
  ): Promise<ServiceResult<ProductionPlanWithRelations>> {
    try {
      const validationError = validatePlanInput(input);

      if (validationError) {
        return { data: null, error: validationError };
      }

      const { data: planData, error: planError } = await supabase
        .from("production_plans")
        .insert({
          name: input.name.trim(),
          status: "draft" satisfies ProductionPlanStatus,
          planning_date: input.planning_date,
          notes: input.notes.trim().length > 0 ? input.notes.trim() : null,
          updated_at: new Date().toISOString(),
        })
        .select("*")
        .single();

      if (planError || !planData) {
        return {
          data: null,
          error: toUserError(planError, "Failed to create production plan"),
        };
      }

      const plan = mapPlan(planData as ProductionPlanRow);
      return this.getProductionPlanById(plan.id);
    } catch (error) {
      return {
        data: null,
        error: toUserError(error, "Failed to create production plan"),
      };
    }
  },

  /**
   * Adds a finished good (active recipe) to a production plan.
   * Does not calculate requirements or change inventory.
   */
  async addProductToPlan(
    planId: string,
    input: AddProductionPlanProductInput,
  ): Promise<ServiceResult<ProductionPlanWithRelations>> {
    try {
      const validationError = getAddPlanProductValidationMessage(input);

      if (validationError) {
        return { data: null, error: validationError };
      }

      const planResult = await this.getProductionPlanById(planId);

      if (planResult.error || !planResult.data) {
        return {
          data: null,
          error: planResult.error ?? "Failed to load production plan",
        };
      }

      const plan = planResult.data;

      if (!isPlanEditable(plan.status)) {
        return { data: null, error: PLAN_LOCKED_ERROR };
      }

      if (
        plan.products.some((product) => product.recipe_id === input.recipe_id)
      ) {
        return { data: null, error: DUPLICATE_PLAN_PRODUCT_ERROR };
      }

      const { data: recipeData, error: recipeError } = await supabase
        .from("recipes")
        .select("id, name, yield_quantity, yield_unit, is_active")
        .eq("id", input.recipe_id)
        .maybeSingle();

      if (recipeError) {
        return {
          data: null,
          error: toUserError(recipeError, "Failed to load recipe"),
        };
      }

      if (!recipeData) {
        return { data: null, error: RECIPE_REQUIRED_ERROR };
      }

      const recipe = mapRecipeOption(recipeData as RecipeRow);

      if (!recipe.is_active) {
        return { data: null, error: ARCHIVED_PRODUCT_ERROR };
      }

      if (recipe.yield_quantity <= 0) {
        return {
          data: null,
          error: `Recipe "${recipe.name}" has an invalid yield`,
        };
      }

      const nextSortOrder =
        plan.products.reduce(
          (max, product) => Math.max(max, product.sort_order),
          -1,
        ) + 1;

      const { error: insertError } = await supabase
        .from("production_plan_products")
        .insert({
          production_plan_id: planId,
          recipe_id: recipe.id,
          recipe_name: recipe.name,
          planned_quantity: input.planned_quantity,
          yield_quantity: recipe.yield_quantity,
          yield_unit: recipe.yield_unit,
          sort_order: nextSortOrder,
        });

      if (insertError) {
        return {
          data: null,
          error: toUserError(insertError, "Failed to add product to plan"),
        };
      }

      const { error: updateError } = await supabase
        .from("production_plans")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", planId);

      if (updateError) {
        return {
          data: null,
          error: toUserError(updateError, "Failed to update production plan"),
        };
      }

      return this.getProductionPlanById(planId);
    } catch (error) {
      return {
        data: null,
        error: toUserError(error, "Failed to add product to plan"),
      };
    }
  },

  /**
   * Updates planned quantity for a product line.
   * Does not calculate requirements or change inventory.
   */
  async updatePlanProductQuantity(
    planId: string,
    productId: string,
    input: UpdateProductionPlanProductQuantityInput,
  ): Promise<ServiceResult<ProductionPlanWithRelations>> {
    try {
      const validationError =
        getUpdatePlanProductQuantityValidationMessage(input);

      if (validationError) {
        return { data: null, error: validationError };
      }

      const planResult = await this.getProductionPlanById(planId);

      if (planResult.error || !planResult.data) {
        return {
          data: null,
          error: planResult.error ?? "Failed to load production plan",
        };
      }

      const plan = planResult.data;

      if (!isPlanEditable(plan.status)) {
        return { data: null, error: PLAN_LOCKED_ERROR };
      }

      const existing = plan.products.find((product) => product.id === productId);

      if (!existing) {
        return {
          data: null,
          error: "Product was not found on this production plan",
        };
      }

      const { error: updateProductError } = await supabase
        .from("production_plan_products")
        .update({
          planned_quantity: input.planned_quantity,
        })
        .eq("id", productId)
        .eq("production_plan_id", planId);

      if (updateProductError) {
        return {
          data: null,
          error: toUserError(
            updateProductError,
            "Failed to update planned quantity",
          ),
        };
      }

      const { error: updateError } = await supabase
        .from("production_plans")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", planId);

      if (updateError) {
        return {
          data: null,
          error: toUserError(updateError, "Failed to update production plan"),
        };
      }

      return this.getProductionPlanById(planId);
    } catch (error) {
      return {
        data: null,
        error: toUserError(error, "Failed to update planned quantity"),
      };
    }
  },

  /**
   * Removes a product line from a production plan.
   * Does not change inventory.
   */
  async removeProductFromPlan(
    planId: string,
    productId: string,
  ): Promise<ServiceResult<ProductionPlanWithRelations>> {
    try {
      const planResult = await this.getProductionPlanById(planId);

      if (planResult.error || !planResult.data) {
        return {
          data: null,
          error: planResult.error ?? "Failed to load production plan",
        };
      }

      const plan = planResult.data;

      if (!isPlanEditable(plan.status)) {
        return { data: null, error: PLAN_LOCKED_ERROR };
      }

      const existing = plan.products.find((product) => product.id === productId);

      if (!existing) {
        return {
          data: null,
          error: "Product was not found on this production plan",
        };
      }

      const { error: deleteError } = await supabase
        .from("production_plan_products")
        .delete()
        .eq("id", productId)
        .eq("production_plan_id", planId);

      if (deleteError) {
        return {
          data: null,
          error: toUserError(deleteError, "Failed to remove product"),
        };
      }

      const { error: updateError } = await supabase
        .from("production_plans")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", planId);

      if (updateError) {
        return {
          data: null,
          error: toUserError(updateError, "Failed to update production plan"),
        };
      }

      return this.getProductionPlanById(planId);
    } catch (error) {
      return {
        data: null,
        error: toUserError(error, "Failed to remove product"),
      };
    }
  },

  /**
   * Builds a shopping list recommendation from snapshot missing quantities.
   * Does not change inventory.
   */
  async generateShoppingList(
    planId: string,
  ): Promise<ServiceResult<ProductionPlanWithRelations>> {
    try {
      const planResult = await this.getProductionPlanById(planId);

      if (planResult.error || !planResult.data) {
        return {
          data: null,
          error: planResult.error ?? "Failed to load production plan",
        };
      }

      const plan = planResult.data;

      if (plan.status === "cancelled" || plan.status === "completed") {
        return {
          data: null,
          error: "Shopping list cannot be generated for this plan status",
        };
      }

      const missingLines = plan.ingredients.filter(
        (line) => line.missing_quantity > 0,
      );

      await supabase
        .from("production_plan_shopping_items")
        .delete()
        .eq("production_plan_id", planId);

      if (missingLines.length > 0) {
        const { error: insertError } = await supabase
          .from("production_plan_shopping_items")
          .insert(
            missingLines.map((line) => ({
              production_plan_id: planId,
              ingredient_id: line.ingredient_id,
              ingredient_name: line.ingredient_name,
              quantity: line.missing_quantity,
              unit: line.unit,
            })),
          );

        if (insertError) {
          return {
            data: null,
            error: toUserError(insertError, "Failed to generate shopping list"),
          };
        }
      }

      const { error: updateError } = await supabase
        .from("production_plans")
        .update({
          shopping_list_generated_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", planId);

      if (updateError) {
        return {
          data: null,
          error: toUserError(updateError, "Failed to update shopping list status"),
        };
      }

      return this.getProductionPlanById(planId);
    } catch (error) {
      return {
        data: null,
        error: toUserError(error, "Failed to generate shopping list"),
      };
    }
  },

  /**
   * Confirms a Draft production plan: server-side snapshots ingredient
   * requirements into production_plan_ingredients, moves the plan to
   * planned, then advances straight to ready_to_produce if every
   * ingredient is already sufficiently stocked (confirm_production_plan,
   * sql/078). The only way to move a fully-stocked Draft plan into the
   * Production Execution queue without first sending a (now-empty)
   * purchase draft.
   */
  async confirmProductionPlan(
    planId: string,
  ): Promise<ServiceResult<ProductionPlanWithRelations>> {
    try {
      const { error } = await supabase.rpc("confirm_production_plan", {
        p_plan_id: planId,
      });

      if (error) {
        return {
          data: null,
          error: toUserError(error, "Failed to confirm production plan"),
        };
      }

      return this.getProductionPlanById(planId);
    } catch (error) {
      return {
        data: null,
        error: toUserError(error, "Failed to confirm production plan"),
      };
    }
  },

  /**
   * Transfers calculated Purchase Draft lines into Purchases as a Draft.
   * Reuses Purchases persistence — Planning never owns purchase documents.
   * Does not receive goods or change inventory.
   */
  async sendPurchaseDraftToPurchases(
    planId: string,
    lines: Array<{ ingredient_id: string; quantity: number }>,
  ): Promise<ServiceResult<ProductionPlanWithRelations>> {
    try {
      const planResult = await this.getProductionPlanById(planId);

      if (planResult.error || !planResult.data) {
        return {
          data: null,
          error: planResult.error ?? "Failed to load production plan",
        };
      }

      const plan = planResult.data;

      if (plan.purchase_draft_status !== "not_created" || plan.linked_purchase) {
        return {
          data: null,
          error: DUPLICATE_PURCHASE_DRAFT_ERROR,
        };
      }

      if (lines.length === 0) {
        return {
          data: null,
          error: EMPTY_PURCHASE_DRAFT_ERROR,
        };
      }

      const normalizedLines = lines
        .map((line) => ({
          ingredient_id: line.ingredient_id.trim(),
          quantity: line.quantity,
        }))
        .filter((line) => line.ingredient_id.length > 0 && line.quantity > 0);

      if (normalizedLines.length === 0) {
        return {
          data: null,
          error: MISSING_PURCHASE_DRAFT_LINES_ERROR,
        };
      }

      const draftResult = await purchaseService.createDraftFromProductionPlan({
        production_plan_id: planId,
        notes: `Generated from Production Plan #${plan.plan_number}`,
        lines: normalizedLines,
      });

      if (draftResult.error || !draftResult.data) {
        const error =
          draftResult.error === "Purchase Draft already exists." ||
          draftResult.error === "Already transferred." ||
          draftResult.error === DUPLICATE_PURCHASE_DRAFT_ERROR
            ? DUPLICATE_PURCHASE_DRAFT_ERROR
            : (draftResult.error ?? "Failed to create purchase draft");

        return {
          data: null,
          error,
        };
      }

      if (plan.status === "planned" || plan.status === "draft") {
        const { error: statusError } = await supabase
          .from("production_plans")
          .update({
            status: "waiting_for_purchases",
            updated_at: new Date().toISOString(),
          })
          .eq("id", planId);

        if (statusError) {
          return {
            data: null,
            error: toUserError(
              statusError,
              "Purchase draft created but plan status failed to update",
            ),
          };
        }
      }

      return this.getProductionPlanById(planId);
    } catch (error) {
      return {
        data: null,
        error: toUserError(error, "Failed to send purchase draft to Purchases"),
      };
    }
  },

  /**
   * @deprecated Prefer sendPurchaseDraftToPurchases with calculated draft lines.
   * Creates a Purchases draft from the persisted shopping list.
   */
  async generatePurchaseDraft(
    planId: string,
  ): Promise<ServiceResult<ProductionPlanWithRelations>> {
    try {
      const planResult = await this.getProductionPlanById(planId);

      if (planResult.error || !planResult.data) {
        return {
          data: null,
          error: planResult.error ?? "Failed to load production plan",
        };
      }

      const plan = planResult.data;

      if (plan.shopping_items.length === 0) {
        return {
          data: null,
          error: EMPTY_PURCHASE_DRAFT_ERROR,
        };
      }

      return this.sendPurchaseDraftToPurchases(
        planId,
        plan.shopping_items.map((item) => ({
          ingredient_id: item.ingredient_id,
          quantity: item.quantity,
        })),
      );
    } catch (error) {
      return {
        data: null,
        error: toUserError(error, "Failed to generate purchase draft"),
      };
    }
  },
};
