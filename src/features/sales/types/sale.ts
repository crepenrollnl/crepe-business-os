/**
 * Sales domain contracts (DEV-026 / DEV-027 / DEV-029 / DEV-034 / DEV-035).
 *
 * Draft path: SQL create_draft_sale owns header insert + sale_number.
 * Line path: SQL add/update/delete_sale_line owns line mutations + commercial totals.
 * Confirm path: SQL confirm_sale owns status, FIFO allocation, and COGS.
 * Read path: sales_list_view / sale_details_view (SQL owns shape; no FIFO / COGS).
 * Specs: docs/SALES.md, docs/BATCH_CONSUMPTION.md
 */

export const SALE_STATUSES = [
  "draft",
  "confirmed",
  "paid",
  "cancelled",
] as const;

export type SaleStatus = (typeof SALE_STATUSES)[number];

export interface Sale {
  id: string;
  sale_number: string;
  customer_id: string | null;
  status: SaleStatus;
  sale_date: string;
  confirmed_at: string | null;
  paid_at: string | null;
  cancelled_at: string | null;
  subtotal: number;
  tax_total: number;
  total: number;
  notes: string | null;
  created_at: string;
  updated_at?: string;
}

export interface SaleLine {
  id: string;
  sale_id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  created_at: string;
}

/** Sale header + lines required by the UI after confirmation. */
export interface SaleWithLines extends Sale {
  lines: SaleLine[];
}

/**
 * confirmSale result.
 * total_cogs comes from confirm_sale RPC only — never calculated in TypeScript.
 */
export interface ConfirmSaleResult {
  sale: SaleWithLines;
  total_cogs: number;
}

/**
 * createDraftSale input (DEV-034).
 * SQL create_draft_sale owns insert + sale_number; service validates UX only.
 */
export interface CreateDraftSaleInput {
  customer_id?: string | null;
  notes?: string | null;
}

/**
 * createDraftSale result.
 * saleId comes from create_draft_sale RPC only — no reload.
 */
export interface CreateDraftSaleResult {
  saleId: string;
}

/**
 * addSaleLine input (DEV-035).
 * SQL add_sale_line owns insert + commercial totals.
 */
export interface AddSaleLineInput {
  sale_id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
}

/**
 * updateSaleLine input (DEV-035).
 * SQL update_sale_line owns quantity update + commercial totals.
 */
export interface UpdateSaleLineInput {
  sale_line_id: string;
  quantity: number;
}

/**
 * deleteSaleLine input (DEV-035).
 * SQL delete_sale_line owns delete + commercial totals.
 */
export interface DeleteSaleLineInput {
  sale_line_id: string;
}

/**
 * Row from sales_list_view (DEV-029).
 * Totals come from SQL — never recomputed in TypeScript.
 */
export interface SaleListItem {
  sale_id: string;
  sale_number: string;
  status: SaleStatus;
  sale_date: string;
  customer_id: string | null;
  subtotal: number;
  tax_total: number;
  total: number;
  confirmed_at: string | null;
  paid_at: string | null;
  cancelled_at: string | null;
}

/**
 * Line fields from sale_details_view (DEV-029).
 */
export interface SaleDetailLine {
  line_id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  line_total: number;
}

/**
 * Sale header + lines assembled from sale_details_view rows (DEV-029).
 * Totals come from SQL — never recomputed in TypeScript.
 */
export interface SaleDetail {
  sale_id: string;
  sale_number: string;
  status: SaleStatus;
  sale_date: string;
  customer_id: string | null;
  subtotal: number;
  tax_total: number;
  total: number;
  confirmed_at: string | null;
  paid_at: string | null;
  cancelled_at: string | null;
  lines: SaleDetailLine[];
}

export type { ServiceResult } from "@/types/service";
