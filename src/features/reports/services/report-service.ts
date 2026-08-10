/**
 * Reports read service (DEV-041).
 *
 * Reads only from report_*_summary SQL views.
 * Does NOT mutate stock, recalculate FIFO/ledger totals, cache, or write tables.
 */

import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import type {
  FinishedGoodsProductionStatus,
  FinishedGoodsSummaryRow,
  InventorySummaryRow,
  PurchaseSummaryRow,
  ReportPurchaseStatus,
  ReportSaleStatus,
  SalesSummaryRow,
} from "../types/report";

const INVENTORY_SUMMARY_VIEW = "report_inventory_summary";
const FINISHED_GOODS_SUMMARY_VIEW = "report_finished_goods_summary";
const SALES_SUMMARY_VIEW = "report_sales_summary";
const PURCHASE_SUMMARY_VIEW = "report_purchase_summary";

const INVENTORY_SELECT =
  "ingredient_id, ingredient_name, unit, category_id, supplier_id, current_stock, minimum_stock, cost_per_unit, stock_value, is_below_minimum";

const FINISHED_GOODS_SELECT =
  "product_id, product_name, available_quantity, active_batch_count, average_unit_cost, inventory_value, oldest_batch_at, newest_batch_at, production_status";

const SALES_SELECT =
  "sale_id, sale_number, status, sale_date, customer_id, subtotal, tax_total, total, confirmed_at, paid_at, cancelled_at";

const PURCHASE_SELECT =
  "purchase_id, supplier_id, status, invoice_number, subtotal, tax_total, total, currency, purchased_at, created_at, updated_at";

const SALE_STATUSES: readonly ReportSaleStatus[] = [
  "draft",
  "confirmed",
  "paid",
  "cancelled",
];

const PURCHASE_STATUSES: readonly ReportPurchaseStatus[] = [
  "draft",
  "received",
  "cancelled",
];

const FG_PRODUCTION_STATUSES: readonly FinishedGoodsProductionStatus[] = [
  "available",
  "out_of_stock",
];

interface InventorySummarySqlRow {
  ingredient_id: string;
  ingredient_name: string;
  unit: string;
  category_id: string | null;
  supplier_id: string | null;
  current_stock: number | string;
  minimum_stock: number | string;
  cost_per_unit: number | string;
  stock_value: number | string;
  is_below_minimum: boolean;
}

interface FinishedGoodsSummarySqlRow {
  product_id: string;
  product_name: string | null;
  available_quantity: number | string;
  active_batch_count: number | string;
  average_unit_cost: number | string | null;
  inventory_value: number | string | null;
  oldest_batch_at: string | null;
  newest_batch_at: string | null;
  production_status: string;
}

interface SalesSummarySqlRow {
  sale_id: string;
  sale_number: string;
  status: string;
  sale_date: string;
  customer_id: string | null;
  subtotal: number | string;
  tax_total: number | string;
  total: number | string;
  confirmed_at: string | null;
  paid_at: string | null;
  cancelled_at: string | null;
}

interface PurchaseSummarySqlRow {
  purchase_id: string;
  supplier_id: string | null;
  status: string;
  invoice_number: string | null;
  subtotal: number | string;
  tax_total: number | string;
  total: number | string;
  currency: string;
  purchased_at: string;
  created_at: string;
  updated_at: string;
}

function toNumber(value: number | string): number {
  return typeof value === "number" ? value : Number(value);
}

function toNullableNumber(
  value: number | string | null,
): number | null {
  if (value === null) {
    return null;
  }
  return toNumber(value);
}

function isSaleStatus(value: string): value is ReportSaleStatus {
  return (SALE_STATUSES as readonly string[]).includes(value);
}

function isPurchaseStatus(value: string): value is ReportPurchaseStatus {
  return (PURCHASE_STATUSES as readonly string[]).includes(value);
}

function isFgProductionStatus(
  value: string,
): value is FinishedGoodsProductionStatus {
  return (FG_PRODUCTION_STATUSES as readonly string[]).includes(value);
}

function mapInventoryRow(row: InventorySummarySqlRow): InventorySummaryRow {
  return {
    ingredient_id: row.ingredient_id,
    ingredient_name: row.ingredient_name,
    unit: row.unit,
    category_id: row.category_id,
    supplier_id: row.supplier_id,
    current_stock: toNumber(row.current_stock),
    minimum_stock: toNumber(row.minimum_stock),
    cost_per_unit: toNumber(row.cost_per_unit),
    stock_value: toNumber(row.stock_value),
    is_below_minimum: row.is_below_minimum,
  };
}

function mapFinishedGoodsRow(
  row: FinishedGoodsSummarySqlRow,
): FinishedGoodsSummaryRow {
  if (!isFgProductionStatus(row.production_status)) {
    throw new Error("Finished goods production status is invalid.");
  }

  return {
    product_id: row.product_id,
    product_name: row.product_name,
    available_quantity: toNumber(row.available_quantity),
    active_batch_count: toNumber(row.active_batch_count),
    average_unit_cost: toNullableNumber(row.average_unit_cost),
    inventory_value: toNullableNumber(row.inventory_value),
    oldest_batch_at: row.oldest_batch_at,
    newest_batch_at: row.newest_batch_at,
    production_status: row.production_status,
  };
}

function mapSalesRow(row: SalesSummarySqlRow): SalesSummaryRow {
  if (!isSaleStatus(row.status)) {
    throw new Error("Sale status is invalid.");
  }

  return {
    sale_id: row.sale_id,
    sale_number: row.sale_number,
    status: row.status,
    sale_date: row.sale_date,
    customer_id: row.customer_id,
    subtotal: toNumber(row.subtotal),
    tax_total: toNumber(row.tax_total),
    total: toNumber(row.total),
    confirmed_at: row.confirmed_at,
    paid_at: row.paid_at,
    cancelled_at: row.cancelled_at,
  };
}

function mapPurchaseRow(row: PurchaseSummarySqlRow): PurchaseSummaryRow {
  if (!isPurchaseStatus(row.status)) {
    throw new Error("Purchase status is invalid.");
  }

  return {
    purchase_id: row.purchase_id,
    supplier_id: row.supplier_id,
    status: row.status,
    invoice_number: row.invoice_number,
    subtotal: toNumber(row.subtotal),
    tax_total: toNumber(row.tax_total),
    total: toNumber(row.total),
    currency: row.currency,
    purchased_at: row.purchased_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapReadError(error: unknown, fallback: string): string {
  return toUserError(error, fallback, {
    map: (err) => {
      const message =
        typeof err === "object" &&
        err !== null &&
        "message" in err &&
        typeof (err as { message: unknown }).message === "string"
          ? (err as { message: string }).message
          : typeof err === "string"
            ? err
            : null;

      if (!message) {
        return null;
      }

      const normalized = message.toLowerCase();

      if (
        (normalized.includes("report_inventory_summary") ||
          normalized.includes("report_finished_goods_summary") ||
          normalized.includes("report_sales_summary") ||
          normalized.includes("report_purchase_summary")) &&
        (normalized.includes("does not exist") ||
          normalized.includes("schema cache") ||
          normalized.includes("42p01"))
      ) {
        return "Reporting views are not available yet. Apply the reporting foundation database script and try again.";
      }

      return null;
    },
  });
}

export const reportService = {
  /**
   * List inventory summary rows from report_inventory_summary.
   */
  async getInventorySummary(): Promise<ServiceResult<InventorySummaryRow[]>> {
    try {
      const { data, error } = await supabase
        .from(INVENTORY_SUMMARY_VIEW)
        .select(INVENTORY_SELECT)
        .order("ingredient_name", { ascending: true })
        .order("ingredient_id", { ascending: true });

      if (error) {
        return fail(mapReadError(error, "Failed to load inventory summary"));
      }

      return ok(
        ((data as InventorySummarySqlRow[] | null) ?? []).map(mapInventoryRow),
      );
    } catch (error) {
      return fail(mapReadError(error, "Failed to load inventory summary"));
    }
  },

  /**
   * List finished-goods summary rows from report_finished_goods_summary.
   */
  async getFinishedGoodsSummary(): Promise<
    ServiceResult<FinishedGoodsSummaryRow[]>
  > {
    try {
      const { data, error } = await supabase
        .from(FINISHED_GOODS_SUMMARY_VIEW)
        .select(FINISHED_GOODS_SELECT)
        .order("product_name", { ascending: true })
        .order("product_id", { ascending: true });

      if (error) {
        return fail(
          mapReadError(error, "Failed to load finished goods summary"),
        );
      }

      try {
        return ok(
          ((data as FinishedGoodsSummarySqlRow[] | null) ?? []).map(
            mapFinishedGoodsRow,
          ),
        );
      } catch {
        return fail("Finished goods summary response was invalid.");
      }
    } catch (error) {
      return fail(
        mapReadError(error, "Failed to load finished goods summary"),
      );
    }
  },

  /**
   * List sales summary rows from report_sales_summary.
   */
  async getSalesSummary(): Promise<ServiceResult<SalesSummaryRow[]>> {
    try {
      const { data, error } = await supabase
        .from(SALES_SUMMARY_VIEW)
        .select(SALES_SELECT)
        .order("sale_date", { ascending: false })
        .order("sale_id", { ascending: true });

      if (error) {
        return fail(mapReadError(error, "Failed to load sales summary"));
      }

      try {
        return ok(
          ((data as SalesSummarySqlRow[] | null) ?? []).map(mapSalesRow),
        );
      } catch {
        return fail("Sales summary response was invalid.");
      }
    } catch (error) {
      return fail(mapReadError(error, "Failed to load sales summary"));
    }
  },

  /**
   * List purchase summary rows from report_purchase_summary.
   */
  async getPurchaseSummary(): Promise<ServiceResult<PurchaseSummaryRow[]>> {
    try {
      const { data, error } = await supabase
        .from(PURCHASE_SUMMARY_VIEW)
        .select(PURCHASE_SELECT)
        .order("purchased_at", { ascending: false })
        .order("purchase_id", { ascending: true });

      if (error) {
        return fail(mapReadError(error, "Failed to load purchase summary"));
      }

      try {
        return ok(
          ((data as PurchaseSummarySqlRow[] | null) ?? []).map(mapPurchaseRow),
        );
      } catch {
        return fail("Purchase summary response was invalid.");
      }
    } catch (error) {
      return fail(mapReadError(error, "Failed to load purchase summary"));
    }
  },
};
