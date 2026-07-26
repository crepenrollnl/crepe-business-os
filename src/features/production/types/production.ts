/**
 * Production Planning domain contracts.
 *
 * Planning never deducts inventory, creates finished goods, or posts accounting.
 * Execution sessions live in production-execution (DEV-014). Inventory/batch
 * posting remains a later phase.
 */

export type ProductionPlanStatus =
  | "draft"
  | "planned"
  | "waiting_for_purchases"
  | "ready_to_produce"
  | "completed"
  | "cancelled";

export type PurchaseDraftLinkStatus =
  | "not_created"
  | "draft_created"
  | "completed";

export type ShoppingListStatus = "not_generated" | "generated";

export interface ProductionRecipeOption {
  id: string;
  name: string;
  yield_quantity: number;
  yield_unit: string;
  is_active: boolean;
}

/**
 * Selectable finished good for planning.
 * Until the Products catalog is live, active recipes represent finished goods.
 */
export type ProductionFinishedGoodOption = ProductionRecipeOption;

export interface ProductionPlanProductLineInput {
  recipe_id: string;
  /** null means the field is empty in the form. */
  planned_quantity: number | null;
}

/** Create-plan form: header fields only (products added in a later step). */
export interface ProductionPlanFormValues {
  name: string;
  planning_date: string;
  notes: string;
}

export type CreateProductionPlanInput = ProductionPlanFormValues;

export interface AddProductionPlanProductInput {
  recipe_id: string;
  planned_quantity: number;
}

export interface UpdateProductionPlanProductQuantityInput {
  planned_quantity: number;
}

export type ProductionPlanProductStatus = "active" | "inactive";

export interface ProductionPlanProduct {
  id: string;
  production_plan_id: string;
  recipe_id: string;
  recipe_name: string;
  planned_quantity: number;
  yield_quantity: number;
  yield_unit: string;
  sort_order: number;
  /** Current recipe activation; inactive recipes cannot be newly selected. */
  status: ProductionPlanProductStatus;
}

export interface ProductionPlanIngredient {
  id: string;
  production_plan_id: string;
  ingredient_id: string;
  ingredient_name: string;
  unit: string;
  required_quantity: number;
  inventory_quantity_at_planning: number;
  missing_quantity: number;
}

export interface ProductionPlanShoppingItem {
  id: string;
  production_plan_id: string;
  ingredient_id: string;
  ingredient_name: string;
  quantity: number;
  unit: string;
}

export interface ProductionPlanLinkedPurchase {
  id: string;
  status: "draft" | "received" | "cancelled";
  invoice_number: string | null;
}

export interface ProductionPlan {
  id: string;
  plan_number: number;
  name: string;
  status: ProductionPlanStatus;
  planning_date: string;
  notes: string | null;
  shopping_list_generated_at: string | null;
  created_at: string;
  updated_at?: string;
}

export interface ProductionPlanSummary {
  planned_product_count: number;
  total_ingredient_lines: number;
  missing_ingredient_lines: number;
  shopping_list_status: ShoppingListStatus;
  purchase_draft_status: PurchaseDraftLinkStatus;
  planning_status: ProductionPlanStatus;
}

export interface ProductionPlanListItem extends ProductionPlan {
  product_count: number;
  missing_ingredient_lines: number;
  shopping_list_status: ShoppingListStatus;
  purchase_draft_status: PurchaseDraftLinkStatus;
  linked_purchase: ProductionPlanLinkedPurchase | null;
}

export interface ProductionPlanWithRelations extends ProductionPlan {
  products: ProductionPlanProduct[];
  ingredients: ProductionPlanIngredient[];
  shopping_items: ProductionPlanShoppingItem[];
  linked_purchase: ProductionPlanLinkedPurchase | null;
  purchase_draft_status: PurchaseDraftLinkStatus;
  shopping_list_status: ShoppingListStatus;
  summary: ProductionPlanSummary;
}

/** Live calculation preview before a plan is saved (not a snapshot). */
export interface ProductionIngredientRequirement {
  ingredient_id: string;
  ingredient_name: string;
  unit: string;
  required_quantity: number;
  current_stock: number;
  missing_quantity: number;
  is_sufficient: boolean;
}

export interface ProductionRequirementPreview {
  lines: ProductionIngredientRequirement[];
  is_inventory_sufficient: boolean;
  missing_line_count: number;
}

/** Display status for a calculated ingredient requirement row. */
export type IngredientRequirementStatus =
  | "available"
  | "low_stock"
  | "missing";

/** Ingredient Requirements workspace row (post-calculation). */
export interface CalculatedIngredientRequirement {
  ingredient_id: string;
  ingredient_name: string;
  required_quantity: number;
  available_quantity: number;
  missing_quantity: number;
  unit: string;
  status: IngredientRequirementStatus;
}

/** Shopping List workspace row — shortage > 0 only. */
export interface CalculatedShoppingListItem {
  ingredient_id: string;
  ingredient_name: string;
  quantity: number;
  unit: string;
}

/** Procurement Recommendation workspace row. */
export interface CalculatedProcurementItem {
  ingredient_id: string;
  ingredient_name: string;
  recommended_quantity: number;
  packages: number;
  reason: string;
  unit: string;
}

/** Purchase Draft Review workspace row (ready to transfer to Purchases). */
export interface CalculatedPurchaseDraftReviewLine {
  supplier_name: string | null;
  ingredient_id: string;
  ingredient_name: string;
  quantity: number;
  packages: number;
  reason: string;
  unit: string;
}

/** Purchase Draft Review summary counters. */
export interface CalculatedPurchaseDraftReviewSummary {
  items: number;
  packages: number;
  total_purchase_quantity: number;
}

/**
 * Full Calculate Requirements workspace result.
 * Produced by the domain pipeline; never mutates inventory or purchases.
 */
export interface ProductionPlanCalculationResult {
  ingredient_requirements: CalculatedIngredientRequirement[];
  shopping_list: CalculatedShoppingListItem[];
  procurement_recommendations: CalculatedProcurementItem[];
  purchase_draft_review: CalculatedPurchaseDraftReviewLine[];
  purchase_draft_summary: CalculatedPurchaseDraftReviewSummary;
  has_shortages: boolean;
}

export type ProductionSortField =
  | "name"
  | "planning_date"
  | "plan_number"
  | "status"
  | "created_at"
  | "updated_at";
export type ProductionSortDirection = "asc" | "desc";

/** @deprecated Kept for future execution phase typing only. */
export type ProductionOrderStatus =
  | "planned"
  | "in_progress"
  | "completed"
  | "cancelled";

/** @deprecated Future execution phase. */
export interface ProductionOrder {
  id: string;
  production_plan_id: string | null;
  recipe_id: string;
  status: ProductionOrderStatus;
  planned_quantity: number;
  produced_quantity: number;
  completed_at: string | null;
  transaction_id: string | null;
  created_at: string;
}

/** @deprecated Future execution phase. */
export interface ProductionItem {
  id: string;
  production_order_id: string;
  ingredient_id: string | null;
  product_id: string | null;
  quantity: number;
  direction: "input" | "output";
}

export type { ServiceResult } from "@/types/service";
