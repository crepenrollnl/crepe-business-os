/**
 * Finished Goods read service (DEV-024 / DEV-104).
 *
 * Reads only from finished_goods_batch_availability.
 * Does NOT allocate, mutate batches/ledger, or recalculate frozen unit_cost.
 */

import { roundMoney } from "@/lib/money";
import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import type { FinishedGoodsAvailableBatch } from "../types/finished-good";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const AVAILABILITY_VIEW = "finished_goods_batch_availability";

const AVAILABILITY_SELECT =
  "production_batch_id, product_id, batch_number, produced_at, produced_quantity, available_quantity, unit_cost, total_batch_cost, remaining_value";

/** Fallback select before sql/059 valuation columns are applied. */
const AVAILABILITY_SELECT_LEGACY =
  "production_batch_id, product_id, batch_number, produced_at, produced_quantity, available_quantity, unit_cost";

interface AvailabilityRow {
  production_batch_id: string;
  product_id: string;
  batch_number: number;
  produced_at: string;
  produced_quantity: number | string;
  available_quantity: number | string;
  unit_cost: number | string;
  total_batch_cost?: number | string | null;
  remaining_value?: number | string | null;
}

function toNumber(value: number | string): number {
  return typeof value === "number" ? value : Number(value);
}

function roundUnitCost(value: number): number {
  const factor = 10 ** 4;
  return Math.round(value * factor) / factor;
}

function mapAvailabilityRow(row: AvailabilityRow): FinishedGoodsAvailableBatch {
  const producedQuantity = toNumber(row.produced_quantity);
  const availableQuantity = toNumber(row.available_quantity);
  const unitCost = roundUnitCost(toNumber(row.unit_cost));

  const totalBatchCost =
    row.total_batch_cost === null || row.total_batch_cost === undefined
      ? roundMoney(producedQuantity * unitCost)
      : roundMoney(toNumber(row.total_batch_cost));

  const remainingValue =
    row.remaining_value === null || row.remaining_value === undefined
      ? roundMoney(availableQuantity * unitCost)
      : roundMoney(toNumber(row.remaining_value));

  return {
    production_batch_id: row.production_batch_id,
    product_id: row.product_id,
    batch_number: row.batch_number,
    produced_at: row.produced_at,
    produced_quantity: producedQuantity,
    available_quantity: availableQuantity,
    unit_cost: unitCost,
    total_batch_cost: totalBatchCost,
    remaining_value: remainingValue,
  };
}

function isMissingValuationColumnError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("total_batch_cost") ||
    normalized.includes("remaining_value")
  ) && (
    normalized.includes("does not exist") ||
    normalized.includes("column") ||
    normalized.includes("42703")
  );
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

async function selectAvailability(query: {
  productId?: string;
  batchId?: string;
}): Promise<{ data: AvailabilityRow[] | null; error: unknown }> {
  let builder = supabase.from(AVAILABILITY_VIEW).select(AVAILABILITY_SELECT);

  if (query.productId) {
    builder = builder.eq("product_id", query.productId);
  }

  if (query.batchId) {
    builder = builder.eq("production_batch_id", query.batchId);
  }

  builder = builder
    .order("produced_at", { ascending: true })
    .order("production_batch_id", { ascending: true });

  const primary = await builder;

  if (!primary.error) {
    return {
      data: (primary.data as AvailabilityRow[] | null) ?? [],
      error: null,
    };
  }

  const message =
    typeof primary.error === "object" &&
    primary.error !== null &&
    "message" in primary.error &&
    typeof (primary.error as { message: unknown }).message === "string"
      ? (primary.error as { message: string }).message
      : "";

  if (!isMissingValuationColumnError(message)) {
    return { data: null, error: primary.error };
  }

  let legacy = supabase
    .from(AVAILABILITY_VIEW)
    .select(AVAILABILITY_SELECT_LEGACY);

  if (query.productId) {
    legacy = legacy.eq("product_id", query.productId);
  }

  if (query.batchId) {
    legacy = legacy.eq("production_batch_id", query.batchId);
  }

  legacy = legacy
    .order("produced_at", { ascending: true })
    .order("production_batch_id", { ascending: true });

  const fallback = await legacy;
  return {
    data: (fallback.data as AvailabilityRow[] | null) ?? null,
    error: fallback.error,
  };
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

        const { data, error } = await selectAvailability({
          productId: trimmed,
        });

        if (error) {
          return fail(
            mapReadError(error, "Failed to load finished goods availability"),
          );
        }

        return ok((data ?? []).map(mapAvailabilityRow));
      }

      const { data, error } = await selectAvailability({});

      if (error) {
        return fail(
          mapReadError(error, "Failed to load finished goods availability"),
        );
      }

      return ok((data ?? []).map(mapAvailabilityRow));
    } catch (error) {
      return fail(
        mapReadError(error, "Failed to load finished goods availability"),
      );
    }
  },

  /**
   * Load availability/valuation rows for specific production batch ids.
   */
  async listAvailableBatchesByIds(
    batchIds: readonly string[],
  ): Promise<ServiceResult<FinishedGoodsAvailableBatch[]>> {
    try {
      const ids = [...new Set(batchIds.map((id) => id.trim()).filter(Boolean))];
      if (ids.length === 0) {
        return ok([]);
      }

      if (ids.some((id) => !UUID_RE.test(id))) {
        return fail("One or more batch ids are invalid.");
      }

      let builder = supabase
        .from(AVAILABILITY_VIEW)
        .select(AVAILABILITY_SELECT)
        .in("production_batch_id", ids)
        .order("produced_at", { ascending: true })
        .order("production_batch_id", { ascending: true });

      let result = await builder;

      if (result.error) {
        const message =
          typeof result.error === "object" &&
          result.error !== null &&
          "message" in result.error &&
          typeof (result.error as { message: unknown }).message === "string"
            ? (result.error as { message: string }).message
            : "";

        if (isMissingValuationColumnError(message)) {
          result = await supabase
            .from(AVAILABILITY_VIEW)
            .select(AVAILABILITY_SELECT_LEGACY)
            .in("production_batch_id", ids)
            .order("produced_at", { ascending: true })
            .order("production_batch_id", { ascending: true });
        }
      }

      if (result.error) {
        return fail(
          mapReadError(result.error, "Failed to load finished goods availability"),
        );
      }

      return ok(
        ((result.data as AvailabilityRow[] | null) ?? []).map(mapAvailabilityRow),
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

      const { data, error } = await selectAvailability({ batchId: trimmed });

      if (error) {
        return fail(
          mapReadError(error, "Failed to load finished goods batch"),
        );
      }

      const row = data?.[0];
      if (!row) {
        return fail("Finished goods batch was not found.");
      }

      return ok(mapAvailabilityRow(row));
    } catch (error) {
      return fail(
        mapReadError(error, "Failed to load finished goods batch"),
      );
    }
  },
};
