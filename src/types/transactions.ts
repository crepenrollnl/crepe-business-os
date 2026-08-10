/**
 * Transaction-first ERP contracts.
 *
 * Every commercial, stock, payroll, tax, and expense operation must eventually
 * create one Transaction. Modules must not invent parallel ledgers.
 */

export type TransactionType =
  | "purchase"
  | "sale"
  | "production"
  | "waste"
  | "transfer"
  | "inventory_adjustment"
  | "salary"
  | "tax"
  | "expense"
  | "refund";

export type TransactionStatus = "draft" | "posted" | "voided";

export type TransactionReferenceType =
  | "purchase"
  | "sale"
  | "production_order"
  | "production_session"
  | "stock_movement"
  | "payment"
  | "manual"
  | "event";

export interface Transaction {
  id: string;
  type: TransactionType;
  status: TransactionStatus;
  reference_type: TransactionReferenceType;
  reference_id: string | null;
  amount: number;
  currency: string;
  description: string | null;
  occurred_at: string;
  posted_at: string | null;
  created_at: string;
  updated_at?: string;
}

export type StockMovementType =
  | "purchase_in"
  | "sale_out"
  | "production_in"
  | "production_out"
  | "waste_out"
  | "transfer_in"
  | "transfer_out"
  | "adjustment";

/**
 * Immutable quantity ledger. Future stock truth lives here.
 * `ingredients.current_stock` remains a read model until posting is enforced.
 */
export interface StockMovement {
  id: string;
  ingredient_id: string | null;
  product_id: string | null;
  movement_type: StockMovementType;
  quantity: number;
  unit_cost: number | null;
  transaction_id: string | null;
  reference_type: TransactionReferenceType;
  reference_id: string | null;
  occurred_at: string;
  created_at: string;
}

export interface StockBatch {
  id: string;
  ingredient_id: string | null;
  product_id: string | null;
  quantity_remaining: number;
  unit_cost: number;
  received_at: string;
  expires_at: string | null;
  supplier_id: string | null;
  purchase_item_id: string | null;
  created_at: string;
}
