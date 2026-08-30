/**
 * Sales by Product report contracts.
 *
 * Read-only period P&L by product_id from get_sales_by_product (sql/109).
 * Never persists. Never recalculates VAT or FIFO in TypeScript.
 */

export type SalesByProductPreset =
  | "today"
  | "this_shift"
  | "this_week"
  | "custom";

export interface SalesByProductRow {
  product_id: string;
  product_name: string;
  quantity: number;
  revenue: number;
  cogs: number;
  gross_profit: number;
  gross_margin_percent: number | null;
}

export interface SalesByProductPeriod {
  from: string;
  to: string;
}

export type SalesByProductSortField =
  | "product_name"
  | "quantity"
  | "revenue"
  | "cogs"
  | "gross_profit"
  | "gross_margin_percent";

export type SalesByProductSortDirection = "asc" | "desc";
