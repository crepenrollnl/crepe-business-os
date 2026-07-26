/**
 * Purchases domain contracts.
 * Received purchases increase ingredient stock via the purchase service.
 * transaction_id is reserved for future Transaction posting.
 */

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
  unit_cost: number;
  line_total: number;
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
  unit_cost: number;
}

export interface PurchaseFormValues {
  supplier_id: string;
  invoice_number: string;
  purchased_at: string;
  notes: string;
  lines: PurchaseLineInput[];
}

export interface SavePurchaseInput extends PurchaseFormValues {
  id?: string;
}

export type PurchaseSortField = "purchased_at" | "total" | "invoice_number" | "status";
export type PurchaseSortDirection = "asc" | "desc";

export type { ServiceResult } from "@/types/service";
