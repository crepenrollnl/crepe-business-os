/**
 * Finished Goods list service — product-level remaining stock for the UI.
 *
 * Owner/partner: quantities and values from reportService.getFinishedGoodsSummary()
 * (SQL view report_finished_goods_summary). Sellers: quantities only, from
 * finished_goods_stock_summary (sql/155) — no cost is read at all.
 * yield_unit is read from recipes. This service does not allocate, mutate
 * batches, or recalculate remaining.
 */

import { reportService } from "@/features/reports/services/report-service";
import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import type { FinishedGoodsListRow } from "../types/finished-good";
import { finishedGoodsStockService } from "./finished-goods-stock-service";

interface RecipeYieldUnitRow {
  id: string;
  yield_unit: string;
}

async function loadYieldUnits(
  productIds: string[],
): Promise<ServiceResult<Map<string, string>>> {
  const { data: recipeRows, error: recipeError } = await supabase
    .from("recipes")
    .select("id, yield_unit")
    .in("id", productIds);

  if (recipeError) {
    return fail(toUserError(recipeError, "Failed to load finished goods units"));
  }

  return ok(
    new Map(
      ((recipeRows as RecipeYieldUnitRow[] | null) ?? []).map((row) => [
        row.id,
        row.yield_unit,
      ]),
    ),
  );
}

export const finishedGoodsListService = {
  async listProductAvailability(): Promise<ServiceResult<FinishedGoodsListRow[]>> {
    try {
      const summaryResult = await reportService.getFinishedGoodsSummary();

      if (summaryResult.error || !summaryResult.data) {
        return fail(
          summaryResult.error ?? "Failed to load finished goods summary",
        );
      }

      const summary = summaryResult.data;
      if (summary.length === 0) {
        return ok([]);
      }

      const unitsResult = await loadYieldUnits(
        summary.map((row) => row.product_id),
      );
      if (unitsResult.error || !unitsResult.data) {
        return fail(unitsResult.error ?? "Failed to load finished goods units");
      }
      const yieldUnitByProductId = unitsResult.data;

      return ok(
        summary.map((row) => ({
          product_id: row.product_id,
          product_name: row.product_name,
          available_quantity: row.available_quantity,
          yield_unit: yieldUnitByProductId.get(row.product_id) ?? null,
          average_unit_cost: row.average_unit_cost,
          remaining_value: row.inventory_value,
          newest_batch_at: row.newest_batch_at,
          production_status: row.production_status,
        })),
      );
    } catch (error) {
      return fail(
        toUserError(error, "Failed to load finished goods availability"),
      );
    }
  },

  /**
   * Seller list: the same products and quantities without any cost
   * (finished_goods_stock_summary, sql/155). average_unit_cost and
   * remaining_value are null — they are never read for a seller.
   */
  async listProductStock(): Promise<ServiceResult<FinishedGoodsListRow[]>> {
    try {
      const stockResult = await finishedGoodsStockService.listStockSummary();

      if (stockResult.error || !stockResult.data) {
        return fail(stockResult.error ?? "Failed to load finished goods stock");
      }

      const stock = stockResult.data;
      if (stock.length === 0) {
        return ok([]);
      }

      const unitsResult = await loadYieldUnits(stock.map((row) => row.product_id));
      if (unitsResult.error || !unitsResult.data) {
        return fail(unitsResult.error ?? "Failed to load finished goods units");
      }
      const yieldUnitByProductId = unitsResult.data;

      return ok(
        stock.map((row) => ({
          product_id: row.product_id,
          product_name: row.product_name,
          available_quantity: row.available_quantity,
          yield_unit: yieldUnitByProductId.get(row.product_id) ?? null,
          average_unit_cost: null,
          remaining_value: null,
          newest_batch_at: row.newest_batch_at,
          production_status: row.production_status,
        })),
      );
    } catch (error) {
      return fail(toUserError(error, "Failed to load finished goods stock"));
    }
  },
};
