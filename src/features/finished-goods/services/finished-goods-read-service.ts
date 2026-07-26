/**
 * Finished Goods read service (DEV-024).
 *
 * Reads only from finished_goods_batch_availability.
 * Does NOT allocate, calculate availability, or mutate batches/ledger.
 */

import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import type { FinishedGoodsAvailableBatch } from "../types/finished-good";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const AVAILABILITY_VIEW = "finished_goods_batch_availability";

const AVAILABILITY_SELECT =
  "production_batch_id, product_id, batch_number, produced_at, produced_quantity, available_quantity, unit_cost";

interface AvailabilityRow {
  production_batch_id: string;
  product_id: string;
  batch_number: number;
  produced_at: string;
  produced_quantity: number | string;
  available_quantity: number | string;
  unit_cost: number | string;
}

function toNumber(value: number | string): number {
  return typeof value === "number" ? value : Number(value);
}

function mapAvailabilityRow(row: AvailabilityRow): FinishedGoodsAvailableBatch {
  return {
    production_batch_id: row.production_batch_id,
    product_id: row.product_id,
    batch_number: row.batch_number,
    produced_at: row.produced_at,
    produced_quantity: toNumber(row.produced_quantity),
    available_quantity: toNumber(row.available_quantity),
    unit_cost: toNumber(row.unit_cost),
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
        normalized.includes("finished_goods_batch_availability") &&
        (normalized.includes("does not exist") ||
          normalized.includes("schema cache") ||
          normalized.includes("42p01"))
      ) {
        return "Finished goods availability is not available yet. Apply the finished-goods availability database script and try again.";
      }

      return null;
    },
  });
}

export const finishedGoodsReadService = {
  /**
   * List batch availability rows from the SQL view.
   * When productId is set, filters to that finished good.
   */
  async listAvailableBatches(
    productId?: string,
  ): Promise<ServiceResult<FinishedGoodsAvailableBatch[]>> {
    try {
      if (productId !== undefined && productId !== null) {
        const trimmed = productId.trim();
        if (!trimmed || !UUID_RE.test(trimmed)) {
          return fail("Product id is required.");
        }

        const { data, error } = await supabase
          .from(AVAILABILITY_VIEW)
          .select(AVAILABILITY_SELECT)
          .eq("product_id", trimmed)
          .order("produced_at", { ascending: true })
          .order("production_batch_id", { ascending: true });

        if (error) {
          return fail(
            mapReadError(error, "Failed to load finished goods availability"),
          );
        }

        return ok(
          ((data as AvailabilityRow[] | null) ?? []).map(mapAvailabilityRow),
        );
      }

      const { data, error } = await supabase
        .from(AVAILABILITY_VIEW)
        .select(AVAILABILITY_SELECT)
        .order("produced_at", { ascending: true })
        .order("production_batch_id", { ascending: true });

      if (error) {
        return fail(
          mapReadError(error, "Failed to load finished goods availability"),
        );
      }

      return ok(
        ((data as AvailabilityRow[] | null) ?? []).map(mapAvailabilityRow),
      );
    } catch (error) {
      return fail(
        mapReadError(error, "Failed to load finished goods availability"),
      );
    }
  },

  /**
   * Load one batch availability row by production_batch_id.
   */
  async getAvailableBatch(
    batchId: string,
  ): Promise<ServiceResult<FinishedGoodsAvailableBatch>> {
    try {
      const trimmed = batchId?.trim() ?? "";
      if (!trimmed || !UUID_RE.test(trimmed)) {
        return fail("Batch id is required.");
      }

      const { data, error } = await supabase
        .from(AVAILABILITY_VIEW)
        .select(AVAILABILITY_SELECT)
        .eq("production_batch_id", trimmed)
        .maybeSingle();

      if (error) {
        return fail(
          mapReadError(error, "Failed to load finished goods batch"),
        );
      }

      if (!data) {
        return fail("Finished goods batch was not found.");
      }

      return ok(mapAvailabilityRow(data as AvailabilityRow));
    } catch (error) {
      return fail(
        mapReadError(error, "Failed to load finished goods batch"),
      );
    }
  },
};
