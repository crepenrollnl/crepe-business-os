/**
 * Sales domain contracts.
 * Posted sales must create a Transaction and stock outflow movements.
 */

export type SaleStatus = "draft" | "completed" | "refunded" | "voided";

export interface Sale {
  id: string;
  customer_id: string | null;
  event_id: string | null;
  status: SaleStatus;
  subtotal: number;
  tax_total: number;
  total: number;
  currency: string;
  sold_at: string;
  transaction_id: string | null;
  created_at: string;
}

export interface SaleItem {
  id: string;
  sale_id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  line_total: number;
}
