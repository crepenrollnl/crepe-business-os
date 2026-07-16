/**
 * Purchases domain contracts.
 * Posted purchases must create a Transaction and stock inflow movements.
 */

export type PurchaseStatus = "draft" | "received" | "cancelled";

export interface Purchase {
  id: string;
  supplier_id: string;
  status: PurchaseStatus;
  invoice_number: string | null;
  subtotal: number;
  tax_total: number;
  total: number;
  currency: string;
  purchased_at: string;
  transaction_id: string | null;
  created_at: string;
}

export interface PurchaseItem {
  id: string;
  purchase_id: string;
  ingredient_id: string;
  quantity: number;
  unit_cost: number;
  line_total: number;
}
