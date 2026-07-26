/**
 * Production Batch service (DEV-015).
 *
 * Read-only access to immutable production batches created on session completion.
 * Never updates or deletes batches.
 */

import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import type {
  ProductionBatch,
  ProductionBatchWithProduct,
} from "../types/production-batch";

interface ProductionBatchRow {
  id: string;
  batch_number: number;
  production_session_id: string;
  production_session_line_id: string;
  finished_good_id: string;
  recipe_id: string;
  produced_quantity: number | string;
  unit_cost: number | string;
  produced_at: string;
  created_at: string;
}

function toNumber(value: number | string): number {
  return typeof value === "number" ? value : Number(value);
}

function mapBatch(row: ProductionBatchRow): ProductionBatch {
  return {
    id: row.id,
    batch_number: row.batch_number,
    production_session_id: row.production_session_id,
    production_session_line_id: row.production_session_line_id,
    finished_good_id: row.finished_good_id,
    recipe_id: row.recipe_id,
    produced_quantity: toNumber(row.produced_quantity),
    unit_cost: toNumber(row.unit_cost),
    produced_at: row.produced_at,
    created_at: row.created_at,
  };
}

export const productionBatchService = {
  async listBySessionId(
    sessionId: string,
  ): Promise<ServiceResult<ProductionBatchWithProduct[]>> {
    try {
      const { data, error } = await supabase
        .from("production_batches")
        .select(
          "id, batch_number, production_session_id, production_session_line_id, finished_good_id, recipe_id, produced_quantity, unit_cost, produced_at, created_at",
        )
        .eq("production_session_id", sessionId)
        .order("batch_number", { ascending: true });

      if (error) {
        return fail(toUserError(error, "Failed to load production batches"));
      }

      const batches =
        (data as ProductionBatchRow[] | null)?.map(mapBatch) ?? [];

      if (batches.length === 0) {
        return ok([]);
      }

      const lineIds = batches.map((batch) => batch.production_session_line_id);
      const { data: lines, error: linesError } = await supabase
        .from("production_session_lines")
        .select("id, product_name, yield_unit")
        .in("id", lineIds);

      if (linesError) {
        return fail(
          toUserError(linesError, "Failed to load production batch details"),
        );
      }

      const lineMap = new Map(
        (
          (lines as Array<{
            id: string;
            product_name: string;
            yield_unit: string;
          }> | null) ?? []
        ).map((line) => [line.id, line]),
      );

      return ok(
        batches.map((batch) => {
          const line = lineMap.get(batch.production_session_line_id);
          return {
            ...batch,
            product_name: line?.product_name ?? "Finished good",
            yield_unit: line?.yield_unit ?? "",
          };
        }),
      );
    } catch (error) {
      return fail(toUserError(error, "Failed to load production batches"));
    }
  },
};
