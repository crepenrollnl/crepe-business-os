/**
 * Purchases domain contracts.
 * Received purchases increase ingredient stock via the purchase service.
 * transaction_id is reserved for future Transaction posting.
 */

import type { TaxPriceMode } from "@/types/tax-engine";

export type PurchaseStatus = "draft" | "received" | "cancelled";

export interface PurchaseSupplier {
  id: string;
  name: string;
}

export interface PurchaseIngredientOption {
  id: string;
  name: string;
  unit: string;
}

export interface Purchase {
  id: string;
  supplier_id: string | null;
  status: PurchaseStatus;
  invoice_number: string | null;
  notes: string | null;
  subtotal: number;
  tax_total: number;
  total: number;
  currency: string;
  purchased_at: string;
  transaction_id: string | null;
  /** Set when this draft was generated from Production Planning. */
  production_plan_id: string | null;
  /**
   * ISO 3166-1 alpha-2 used as calculate_purchase_taxes p_country.
   * Null on rows saved before sql/108.
   */
  tax_country: string | null;
  /**
   * ISO 3166-1 alpha-2 as typed on the purchase header.
   * Null on rows saved before sql/108. Not stored on suppliers.
   */
  supplier_country: string | null;
  created_at: string;
  updated_at?: string;
}

export interface CreatePlanningPurchaseDraftInput {
  production_plan_id: string;
  notes: string;
  lines: Array<{
    ingredient_id: string;
    quantity: number;
  }>;
}

export interface PurchaseItem {
  id: string;
  purchase_id: string;
  ingredient_id: string;
  quantity: number;
  /** Exclusive net unit price — source of truth for sql/069 and cost history. */
  unit_cost: number;
  line_total: number;
  /** Opaque tax category used at calculation time. Null on pre-sql/102 rows. */
  tax_category: string | null;
  /** Opaque tax regime hint used at calculation time. Null on pre-sql/102 rows. */
  tax_regime: string | null;
  /**
   * Whether `entered_unit_price` was typed inclusive of tax.
   * Null on pre-sql/102 rows. `unit_cost` is always exclusive net.
   */
  price_mode: TaxPriceMode | null;
  /**
   * Unit amount as typed on the form (may be gross). Display-only memory.
   * Null on pre-sql/102 rows.
   */
  entered_unit_price: number | null;
  /**
   * Absolute line discount in document currency (same units as sql/069/072).
   * Null on rows saved before sql/108. Not a percent.
   */
  discount: number | null;
}

export interface PurchaseItemWithRelations extends PurchaseItem {
  ingredient: PurchaseIngredientOption | null;
}

export interface PurchaseWithRelations extends Purchase {
  supplier: PurchaseSupplier | null;
  items: PurchaseItemWithRelations[];
}

export interface PurchaseListItem extends Purchase {
  supplier: PurchaseSupplier | null;
  item_count: number;
}

export interface PurchaseLineInput {
  ingredient_id: string;
  quantity: number;
  /**
   * On the form: the unit amount the user typed (may be gross).
   * On persist: exclusive net unit price for sql/069 (`toNetPurchaseLines`).
   */
  unit_cost: number;
  /**
   * Absolute discount in document currency (tax preview / calculation).
   * Null when unrecorded; omitted/undefined is treated the same on persist.
   */
  discount?: number | null;
  /** Opaque tax category for Tax Integration (e.g. goods, food). */
  tax_category?: string | null;
  /** Optional regime override hint for Country Pack matching. */
  tax_regime?: string | null;
  /** How the typed unit amount should be sent to calculate_purchase_taxes. */
  price_mode?: TaxPriceMode | null;
  /**
   * Typed unit amount remembered for reopen (may be gross).
   * Set by `toNetPurchaseLines` before persist.
   */
  entered_unit_price?: number | null;
}

export interface PurchaseFormValues {
  supplier_id: string;
  invoice_number: string;
  purchased_at: string;
  notes: string;
  /**
   * Supplier country ISO 3166-1 alpha-2 as typed on the header.
   * New documents default to NL in emptyFormValues. Reopen uses the stored
   * value; empty string means unrecorded (NULL in the database).
   */
  supplier_country?: string;
  /**
   * Tax pack country ISO 3166-1 alpha-2 (calculate_purchase_taxes p_country).
   * New documents default to NL in emptyFormValues. Reopen uses the stored
   * value; empty string means unrecorded (NULL in the database).
   */
  tax_country?: string;
  lines: PurchaseLineInput[];
}

export interface SavePurchaseInput extends PurchaseFormValues {
  id?: string;
  /** Optional tax total from Purchase Tax Service (persisted on header). */
  tax_total?: number;
}

export type PurchaseSortField = "purchased_at" | "total" | "invoice_number" | "status";
export type PurchaseSortDirection = "asc" | "desc";

export type { ServiceResult } from "@/types/service";
