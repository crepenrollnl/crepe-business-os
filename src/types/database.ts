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
} as const;

export const PLANNED_TABLES = {
  products: "products",
  recipes: "recipes",
  recipeItems: "recipe_items",
  purchases: "purchases",
  purchaseItems: "purchase_items",
  stockMovements: "stock_movements",
  stockBatches: "stock_batches",
  sales: "sales",
  saleItems: "sale_items",
  customers: "customers",
  events: "events",
  productionOrders: "production_orders",
  productionItems: "production_items",
  transactions: "transactions",
  accounts: "accounts",
  journalEntries: "journal_entries",
  payments: "payments",
  taxRates: "tax_rates",
  vatPeriods: "vat_periods",
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
