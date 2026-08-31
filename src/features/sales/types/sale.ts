/**
 * Sales domain contracts (DEV-026 / DEV-027 / DEV-029 / DEV-034 / DEV-035 / DEV-108).
 *
 * Draft path: SQL create_draft_sale owns header insert + sale_number.
 * Line path: SQL add/update/delete_sale_line owns line mutations + commercial totals.
 * Confirm path: SQL confirm_sale owns status + FIFO allocation (ledger COGS layers).
 * COGS path: saleCogsService assembles frozen valuation from consumptions (DEV-108).
 * Profit path: saleProfitService freezes net revenue − COGS (DEV-110).
 * Read path: sales_list_view / sale_details_view (SQL owns commercial shape).
 * Specs: docs/SALES.md, docs/BATCH_CONSUMPTION.md
 */

export const SALE_STATUSES = [
  "draft",
  "confirmed",
  "paid",
  "cancelled",
] as const;

export type SaleStatus = (typeof SALE_STATUSES)[number];

export const SALE_DISCOUNT_TYPES = ["percent", "amount"] as const;

export type SaleDiscountType = (typeof SALE_DISCOUNT_TYPES)[number];

export interface Sale {
  id: string;
  sale_number: string;
  customer_id: string | null;
  status: SaleStatus;
  sale_date: string;
  confirmed_at: string | null;
  paid_at: string | null;
  cancelled_at: string | null;
  fulfilled_at: string | null;
  is_paid: boolean;
  subtotal: number;
  tax_total: number;
  total: number;
  notes: string | null;
  kitchen_note: string | null;
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
 * One line of a quick-sale cart, shaped exactly as create_and_confirm_sale's
 * p_lines expects (sql/086_quick_sale.sql).
 */
export interface QuickSaleLineInput {
  product_id: string;
  quantity: number;
  unit_price: number;
}

/**
 * createAndConfirmSale input (DEV-112 / sql/086_quick_sale.sql).
 * SQL create_and_confirm_sale owns create + line inserts + confirm in one
 * transaction — no separate create_draft_sale / add_sale_line / confirmSale
 * calls for this path.
 */
export interface CreateAndConfirmSaleInput {
  customer_id?: string | null;
  kitchen_note?: string | null;
  discount_type?: SaleDiscountType | null;
  discount_value?: number | null;
  lines: QuickSaleLineInput[];
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
  discount_type: SaleDiscountType | null;
  discount_value: number | null;
  discount_amount: number | null;
  lines: SaleDetailLine[];
}

/**
 * One line of a kitchen-queue ticket. product_id is the recipe id
 * (sql/013); the display name is resolved in the POS hook via
 * recipeService.getRecipes(), not stored on sale_lines.
 */
export interface QueuedSaleLine {
  product_id: string;
  quantity: number;
}

/**
 * Confirmed/paid sale waiting in the kitchen queue (fulfilled_at IS NULL).
 */
export interface QueuedSale {
  sale_id: string;
  sale_number: string;
  confirmed_at: string | null;
  total: number;
  is_paid: boolean;
  kitchen_note: string | null;
  lines: QueuedSaleLine[];
}

export type { ServiceResult } from "@/types/service";
