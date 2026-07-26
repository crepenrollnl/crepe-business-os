/**
 * Canonical database table registry for Crepe'n Roll OS.
 *
 * Live tables are safe to query today.
 * Planned tables define the target ERP schema and must guide future migrations.
 */

export const LIVE_TABLES = {
  ingredients: "ingredients",
  ingredientCategories: "ingredient_categories",
  suppliers: "suppliers",
  purchases: "purchases",
  purchaseItems: "purchase_items",
  recipes: "recipes",
  recipeItems: "recipe_items",
  productionPlans: "production_plans",
  productionPlanProducts: "production_plan_products",
  productionPlanIngredients: "production_plan_ingredients",
  productionPlanShoppingItems: "production_plan_shopping_items",
  productionSessions: "production_sessions",
  productionSessionLines: "production_session_lines",
  productionBatches: "production_batches",
  stockMovements: "stock_movements",
  transactions: "transactions",
} as const;

export const PLANNED_TABLES = {
  products: "products",
  stockBatches: "stock_batches",
  sales: "sales",
  saleItems: "sale_items",
  saleBatchConsumptions: "sale_batch_consumptions",
  customers: "customers",
  events: "events",
  productionOrders: "production_orders",
  productionItems: "production_items",
  accounts: "accounts",
  journalEntries: "journal_entries",
  payments: "payments",
  bankAccounts: "bank_accounts",
  taxRates: "tax_rates",
  vatPeriods: "vat_periods",
  fixedAssets: "fixed_assets",
} as const;

export type LiveTable = (typeof LIVE_TABLES)[keyof typeof LIVE_TABLES];
export type PlannedTable = (typeof PLANNED_TABLES)[keyof typeof PLANNED_TABLES];
export type DatabaseTable = LiveTable | PlannedTable;

/**
 * Shared identity aliases used across domain contracts.
 * Feature modules may narrow these further when tables are implemented.
 */
export interface Timestamps {
  created_at: string;
  updated_at?: string;
}

export interface SoftDeletable {
  deleted_at: string | null;
}
