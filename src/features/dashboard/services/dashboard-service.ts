/**
 * Dashboard read service (DEV-042 / DEV-044).
 *
 * Reads exclusively from dashboard_summary.
 * Does NOT mutate stock, recalculate KPIs, cache, or write tables.
 */

import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import type { DashboardSummary } from "../types/dashboard";

const DASHBOARD_SUMMARY_VIEW = "dashboard_summary";

const DASHBOARD_SELECT = [
  "total_inventory_value",
  "inventory_items_below_minimum",
  "finished_goods_available",
  "total_sales_count",
  "total_purchase_count",
  "active_customers_count",
  "active_suppliers_count",
  "low_stock_items",
  "out_of_stock_items",
  "batches_in_progress",
  "finished_batches_today",
  "draft_sales_count",
  "confirmed_sales_today",
  "draft_purchase_count",
  "completed_purchases_today",
  "last_inventory_movement_at",
  "last_sale_at",
  "last_purchase_at",
].join(", ");

interface DashboardSummarySqlRow {
  total_inventory_value: number | string;
  inventory_items_below_minimum: number | string;
  finished_goods_available: number | string;
  total_sales_count: number | string;
  total_purchase_count: number | string;
  active_customers_count: number | string;
  active_suppliers_count: number | string;
  low_stock_items: number | string;
  out_of_stock_items: number | string;
  batches_in_progress: number | string;
  finished_batches_today: number | string;
  draft_sales_count: number | string;
  confirmed_sales_today: number | string;
  draft_purchase_count: number | string;
  completed_purchases_today: number | string;
  last_inventory_movement_at: string | null;
  last_sale_at: string | null;
  last_purchase_at: string | null;
}

function toNumber(value: number | string): number {
  return typeof value === "number" ? value : Number(value);
}

function mapDashboardRow(row: DashboardSummarySqlRow): DashboardSummary {
  return {
    total_inventory_value: toNumber(row.total_inventory_value),
    inventory_items_below_minimum: toNumber(row.inventory_items_below_minimum),
    finished_goods_available: toNumber(row.finished_goods_available),
    total_sales_count: toNumber(row.total_sales_count),
    total_purchase_count: toNumber(row.total_purchase_count),
    active_customers_count: toNumber(row.active_customers_count),
    active_suppliers_count: toNumber(row.active_suppliers_count),
    low_stock_items: toNumber(row.low_stock_items),
    out_of_stock_items: toNumber(row.out_of_stock_items),
    batches_in_progress: toNumber(row.batches_in_progress),
    finished_batches_today: toNumber(row.finished_batches_today),
    draft_sales_count: toNumber(row.draft_sales_count),
    confirmed_sales_today: toNumber(row.confirmed_sales_today),
    draft_purchase_count: toNumber(row.draft_purchase_count),
    completed_purchases_today: toNumber(row.completed_purchases_today),
    last_inventory_movement_at: row.last_inventory_movement_at,
    last_sale_at: row.last_sale_at,
    last_purchase_at: row.last_purchase_at,
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
        normalized.includes("dashboard_summary") &&
        (normalized.includes("does not exist") ||
          normalized.includes("schema cache") ||
          normalized.includes("42p01"))
      ) {
        return "Dashboard summary is not available yet. Apply the dashboard foundation database script and try again.";
      }

      return null;
    },
  });
}

export const dashboardService = {
  /**
   * Load the single dashboard_summary KPI row (foundation + operational KPIs).
   */
  async getDashboardSummary(): Promise<ServiceResult<DashboardSummary>> {
    try {
      const { data, error } = await supabase
        .from(DASHBOARD_SUMMARY_VIEW)
        .select(DASHBOARD_SELECT)
        .maybeSingle();

      if (error) {
        return fail(mapReadError(error, "Failed to load dashboard summary"));
      }

      if (!data) {
        return fail("Dashboard summary was not found.");
      }

      return ok(mapDashboardRow(data as DashboardSummarySqlRow));
    } catch (error) {
      return fail(mapReadError(error, "Failed to load dashboard summary"));
    }
  },
};
