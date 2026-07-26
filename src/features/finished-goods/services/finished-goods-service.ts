/**
 * Finished Goods service (DEV-023).
 *
 * Orchestrates allocate_finished_goods_fifo only.
 * Does NOT implement FIFO, remaining math, batch updates, or ledger inserts.
 */

import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import type {
  AllocateFinishedGoodsInput,
  AllocateFinishedGoodsResult,
  FinishedGoodsAllocation,
  FinishedGoodsAllocationLayer,
  FinishedGoodsAllocationReason,
  FinishedGoodsBatchReadModel,
  FinishedGoodsSourceType,
} from "../types/finished-good";
import {
  FINISHED_GOODS_ALLOCATION_REASONS,
  FINISHED_GOODS_SOURCE_TYPES,
} from "../types/finished-good";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface ProductionBatchRow {
  id: string;
  batch_number: number;
  finished_good_id: string;
  produced_quantity: number | string;
  unit_cost: number | string;
  produced_at: string;
  created_at: string;
}

function toNumber(value: number | string): number {
  return typeof value === "number" ? value : Number(value);
}

function isAllocationReason(
  value: string,
): value is FinishedGoodsAllocationReason {
  return (FINISHED_GOODS_ALLOCATION_REASONS as readonly string[]).includes(
    value,
  );
}

function isSourceType(value: string): value is FinishedGoodsSourceType {
  return (FINISHED_GOODS_SOURCE_TYPES as readonly string[]).includes(value);
}

function validateAllocateInput(
  input: AllocateFinishedGoodsInput,
): string | null {
  if (!input.product_id || !UUID_RE.test(input.product_id.trim())) {
    return "Product id is required.";
  }

  if (
    input.quantity === null ||
    input.quantity === undefined ||
    Number.isNaN(Number(input.quantity)) ||
    Number(input.quantity) <= 0
  ) {
    return "Enter a quantity greater than zero.";
  }

  if (!input.reason || !isAllocationReason(input.reason)) {
    return "Invalid allocation reason.";
  }

  if (!input.source_type || !isSourceType(input.source_type)) {
    return "Invalid source type.";
  }

  if (!input.source_id || !UUID_RE.test(input.source_id.trim())) {
    return "Source id is required.";
  }

  return null;
}

function mapAllocateRpcError(message: string): string | null {
  const normalized = message.toLowerCase();

  if (normalized.includes("product was not found")) {
    return "Product was not found.";
  }

  if (normalized.includes("quantity must be greater than zero")) {
    return "Enter a quantity greater than zero.";
  }

  if (normalized.includes("product id is required")) {
    return "Product id is required.";
  }

  if (normalized.includes("source id is required")) {
    return "Source id is required.";
  }

  if (normalized.includes("allocation reason is required")) {
    return "Invalid allocation reason.";
  }

  if (normalized.includes("source type is required")) {
    return "Invalid source type.";
  }

  if (normalized.includes("invalid allocation reason")) {
    return "Invalid allocation reason.";
  }

  if (normalized.includes("invalid source type")) {
    return "Invalid source type.";
  }

  if (
    normalized.includes("already been allocated") ||
    normalized.includes("finished_goods_batch_consumptions_source_batch_uidx") ||
    (normalized.includes("duplicate") &&
      normalized.includes("finished_goods_batch_consumptions"))
  ) {
    return "This item was already allocated.";
  }

  if (normalized.includes("insufficient finished goods stock")) {
    return "Not enough finished goods in stock.";
  }

  if (
    normalized.includes("remaining is negative") ||
    normalized.includes("would make batch remaining negative") ||
    normalized.includes("ledger integrity error")
  ) {
    return "Finished goods data is inconsistent. Contact support.";
  }

  if (
    normalized.includes("could not find the function") ||
    (normalized.includes("allocate_finished_goods_fifo") &&
      (normalized.includes("schema cache") ||
        normalized.includes("does not exist") ||
        normalized.includes("42883")))
  ) {
    return "Allocation is not available yet. Apply the finished-goods allocation database script and try again.";
  }

  return null;
}

function mapAllocateError(error: unknown, fallback: string): string {
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
      return message ? mapAllocateRpcError(message) : null;
    },
  });
}

function mapAllocationLayer(raw: unknown): FinishedGoodsAllocationLayer | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }

  const row = raw as Record<string, unknown>;
  const consumptionId = row.consumption_id;
  const productionBatchId = row.production_batch_id;
  const quantity = row.quantity;
  const unitCost = row.unit_cost;
  const totalCost = row.total_cost;
  const producedAt = row.produced_at;

  if (
    typeof consumptionId !== "string" ||
    typeof productionBatchId !== "string" ||
    (typeof quantity !== "number" && typeof quantity !== "string") ||
    (typeof unitCost !== "number" && typeof unitCost !== "string") ||
    (typeof totalCost !== "number" && typeof totalCost !== "string") ||
    typeof producedAt !== "string"
  ) {
    return null;
  }

  return {
    consumption_id: consumptionId,
    production_batch_id: productionBatchId,
    quantity: toNumber(quantity),
    unit_cost: toNumber(unitCost),
    total_cost: toNumber(totalCost),
    produced_at: producedAt,
  };
}

function mapAllocationRpcResult(data: unknown): FinishedGoodsAllocation | null {
  if (typeof data !== "object" || data === null) {
    return null;
  }

  const row = data as Record<string, unknown>;
  const productId = row.product_id;
  const requestedQuantity = row.requested_quantity;
  const allocatedQuantity = row.allocated_quantity;
  const totalCost = row.total_cost;
  const reason = row.reason;
  const sourceType = row.source_type;
  const sourceId = row.source_id;
  const allocationsRaw = row.allocations;

  if (
    typeof productId !== "string" ||
    (typeof requestedQuantity !== "number" &&
      typeof requestedQuantity !== "string") ||
    (typeof allocatedQuantity !== "number" &&
      typeof allocatedQuantity !== "string") ||
    (typeof totalCost !== "number" && typeof totalCost !== "string") ||
    typeof reason !== "string" ||
    typeof sourceType !== "string" ||
    typeof sourceId !== "string" ||
    !Array.isArray(allocationsRaw)
  ) {
    return null;
  }

  const allocations: FinishedGoodsAllocationLayer[] = [];
  for (const layer of allocationsRaw) {
    const mapped = mapAllocationLayer(layer);
    if (!mapped) {
      return null;
    }
    allocations.push(mapped);
  }

  return {
    product_id: productId,
    requested_quantity: toNumber(requestedQuantity),
    allocated_quantity: toNumber(allocatedQuantity),
    total_cost: toNumber(totalCost),
    reason,
    source_type: sourceType,
    source_id: sourceId,
    allocations,
  };
}

function mapBatchRow(row: ProductionBatchRow): FinishedGoodsBatchReadModel {
  return {
    id: row.id,
    batch_number: row.batch_number,
    finished_good_id: row.finished_good_id,
    produced_quantity: toNumber(row.produced_quantity),
    unit_cost: toNumber(row.unit_cost),
    produced_at: row.produced_at,
    created_at: row.created_at,
  };
}

async function reloadBatchesForProduct(
  productId: string,
): Promise<ServiceResult<FinishedGoodsBatchReadModel[]>> {
  const { data, error } = await supabase
    .from("production_batches")
    .select(
      "id, batch_number, finished_good_id, produced_quantity, unit_cost, produced_at, created_at",
    )
    .eq("finished_good_id", productId)
    .order("produced_at", { ascending: true })
    .order("id", { ascending: true });

  if (error) {
    return fail(
      toUserError(error, "Failed to reload finished goods batches"),
    );
  }

  return ok(
    ((data as ProductionBatchRow[] | null) ?? []).map(mapBatchRow),
  );
}

export const finishedGoodsService = {
  /**
   * Allocate finished goods via FIFO SQL RPC, then reload product batches.
   * Remaining quantity is never calculated here.
   */
  async allocateFinishedGoods(
    input: AllocateFinishedGoodsInput,
  ): Promise<ServiceResult<AllocateFinishedGoodsResult>> {
    try {
      const validationError = validateAllocateInput(input);
      if (validationError) {
        return fail(validationError);
      }

      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError || !user) {
        return fail("You must be signed in to allocate finished goods.");
      }

      const notes = input.notes?.trim() ? input.notes.trim() : null;

      const { data, error } = await supabase.rpc(
        "allocate_finished_goods_fifo",
        {
          p_product_id: input.product_id.trim(),
          p_quantity: Number(input.quantity),
          p_reason: input.reason,
          p_source_type: input.source_type,
          p_source_id: input.source_id.trim(),
          p_notes: notes,
          p_created_by: user.id,
        },
      );

      if (error) {
        return fail(
          mapAllocateError(error, "Failed to allocate finished goods."),
        );
      }

      const allocation = mapAllocationRpcResult(data);
      if (!allocation) {
        return fail("Allocation completed but the response was invalid.");
      }

      const batchesResult = await reloadBatchesForProduct(allocation.product_id);
      if (batchesResult.error || !batchesResult.data) {
        return fail(
          batchesResult.error ?? "Failed to reload finished goods batches",
        );
      }

      return ok({
        allocation,
        batches: batchesResult.data,
      });
    } catch (error) {
      return fail(
        mapAllocateError(error, "Failed to allocate finished goods."),
      );
    }
  },
};
