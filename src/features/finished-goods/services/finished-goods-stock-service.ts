/**
 * Finished goods stock WITHOUT costs (sql/155, audit S4/U5 phase 2a).
 *
 * Reads finished_goods_stock_summary: the same quantities as
 * report_finished_goods_summary, minus average unit cost and stock value.
 * Used by every screen that only needs "how much is there" (POS, Quick Sale,
 * the seller's Finished goods tab), so those screens keep working after the
 * cost-bearing tables are closed to sellers (phase 2b).
 */

import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import type { FinishedGoodsStockSummaryRow } from "../types/finished-good";

const STOCK_SUMMARY_SELECT =
  "product_id, product_name, available_quantity, active_batch_count, oldest_batch_at, newest_batch_at, production_status";

interface StockSummarySqlRow {
  product_id: string;
  product_name: string | null;
  available_quantity: number | string;
  active_batch_count: number | string;
  oldest_batch_at: string | null;
  newest_batch_at: string | null;
  production_status: string;
}

function toNumber(value: number | string): number {
  return typeof value === "number" ? value : Number(value);
}

function isStockStatus(
  value: string,
): value is FinishedGoodsStockSummaryRow["production_status"] {
  return value === "available" || value === "out_of_stock";
}

function mapStockSummaryRow(
  row: StockSummarySqlRow,
): FinishedGoodsStockSummaryRow {
  if (!isStockStatus(row.production_status)) {
    throw new Error("Finished goods production status is invalid.");
  }

  return {
    product_id: row.product_id,
    product_name: row.product_name,
    available_quantity: toNumber(row.available_quantity),
    active_batch_count: toNumber(row.active_batch_count),
    oldest_batch_at: row.oldest_batch_at,
    newest_batch_at: row.newest_batch_at,
    production_status: row.production_status,
  };
}

export const finishedGoodsStockService = {
  async listStockSummary(): Promise<
    ServiceResult<FinishedGoodsStockSummaryRow[]>
  > {
    try {
      const { data, error } = await supabase
        .from("finished_goods_stock_summary")
        .select(STOCK_SUMMARY_SELECT)
        .order("product_name", { ascending: true })
        .order("product_id", { ascending: true });

      if (error) {
        return fail(toUserError(error, "Failed to load finished goods stock"));
      }

      return ok(
        ((data as StockSummarySqlRow[] | null) ?? []).map(mapStockSummaryRow),
      );
    } catch (error) {
      return fail(toUserError(error, "Failed to load finished goods stock"));
    }
  },
};
