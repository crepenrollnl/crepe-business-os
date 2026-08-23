/**
 * Finished Goods list service — product-level remaining stock for the UI.
 *
 * Quantities and values come from reportService.getFinishedGoodsSummary()
 * (SQL view report_finished_goods_summary). yield_unit is read from recipes.
 * This service does not allocate, mutate batches, or recalculate remaining.
 */

import { reportService } from "@/features/reports/services/report-service";
import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import type { FinishedGoodsListRow } from "../types/finished-good";

interface RecipeYieldUnitRow {
  id: string;
  yield_unit: string;
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

      const productIds = summary.map((row) => row.product_id);
      const { data: recipeRows, error: recipeError } = await supabase
        .from("recipes")
        .select("id, yield_unit")
        .in("id", productIds);

      if (recipeError) {
        return fail(
          toUserError(recipeError, "Failed to load finished goods units"),
        );
      }

      const yieldUnitByProductId = new Map(
        ((recipeRows as RecipeYieldUnitRow[] | null) ?? []).map((row) => [
          row.id,
          row.yield_unit,
        ]),
      );

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
};
