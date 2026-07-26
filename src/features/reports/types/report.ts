/**
 * Reports domain contracts (DEV-041).
 *
 * Read path: report_*_summary SQL views.
 * SQL owns projections and derived fields — never recalculate in TypeScript.
 * Reports do not own a second ledger.
 */

export type ReportId =
  | "inventory_valuation"
  | "product_margin"
  | "sales_summary"
  | "purchase_summary"
  | "production_summary"
  | "profit_and_loss"
  | "balance_sheet"
  | "vat_return";

export interface ReportRequest {
  report_id: ReportId;
  date_from: string;
  date_to: string;
}

export interface ReportResult<TData> {
  report_id: ReportId;
  generated_at: string;
  data: TData;
}

/**
 * Row from report_inventory_summary.
 * stock_value / is_below_minimum come from SQL.
 */
export interface InventorySummaryRow {
  ingredient_id: string;
  ingredient_name: string;
  unit: string;
  category_id: string | null;
  supplier_id: string | null;
  current_stock: number;
  minimum_stock: number;
  cost_per_unit: number;
  stock_value: number;
  is_below_minimum: boolean;
}

export type FinishedGoodsProductionStatus = "available" | "out_of_stock";

/**
 * Row from report_finished_goods_summary.
 * available_quantity / average_unit_cost / production_status come from SQL.
 */
export interface FinishedGoodsSummaryRow {
  product_id: string;
  product_name: string | null;
  available_quantity: number;
  active_batch_count: number;
  average_unit_cost: number | null;
  inventory_value: number | null;
  oldest_batch_at: string | null;
  newest_batch_at: string | null;
  production_status: FinishedGoodsProductionStatus;
}

export type ReportSaleStatus = "draft" | "confirmed" | "paid" | "cancelled";

/**
 * Row from report_sales_summary.
 * Totals come from SQL — never recomputed in TypeScript.
 */
export interface SalesSummaryRow {
  sale_id: string;
  sale_number: string;
  status: ReportSaleStatus;
  sale_date: string;
  customer_id: string | null;
  subtotal: number;
  tax_total: number;
  total: number;
  confirmed_at: string | null;
  paid_at: string | null;
  cancelled_at: string | null;
}

export type ReportPurchaseStatus = "draft" | "received" | "cancelled";

/**
 * Row from report_purchase_summary.
 * Totals come from SQL — never recomputed in TypeScript.
 */
export interface PurchaseSummaryRow {
  purchase_id: string;
  supplier_id: string | null;
  status: ReportPurchaseStatus;
  invoice_number: string | null;
  subtotal: number;
  tax_total: number;
  total: number;
  currency: string;
  purchased_at: string;
  created_at: string;
  updated_at: string;
}

export type { ServiceResult } from "@/types/service";
