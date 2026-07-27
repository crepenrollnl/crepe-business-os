/**
 * Finished Goods Batch Consumption (DEV-107).
 *
 * Pure FIFO selection + remaining quantity/value projection.
 * Mirrors allocate_finished_goods_fifo ordering rules for inventory consistency.
 *
 * Does NOT:
 *   - write ledger rows (SQL owns persistence)
 *   - mutate production_batches
 *   - calculate sale COGS / profit
 *   - create accounting postings
 *
 * Specs: docs/BATCH_CONSUMPTION.md, docs/FINISHED_GOODS.md, docs/SALES.md
 */

import { calculateMoneyLineTotal } from "@/lib/money";
import type { FinishedGoodsAvailableBatch } from "../types/finished-good";
import type {
  FinishedGoodsBatchRemaining,
  FinishedGoodsConsumptionLayer,
  FinishedGoodsConsumptionPlan,
} from "../types/finished-goods-consumption";
import { calculateRemainingValue } from "./finished-goods-valuation";

export type FifoBatchCandidate = Pick<
  FinishedGoodsAvailableBatch,
  | "production_batch_id"
  | "produced_quantity"
  | "available_quantity"
  | "unit_cost"
  | "produced_at"
>;

/**
 * Validate consumption quantity before FIFO planning or RPC.
 */
export function validateConsumptionQuantity(quantity: number): string | null {
  if (quantity === null || quantity === undefined || Number.isNaN(quantity)) {
    return "Enter a quantity greater than zero.";
  }

  if (quantity === 0) {
    return "Enter a quantity greater than zero.";
  }

  if (quantity < 0) {
    return "Quantity cannot be negative.";
  }

  if (!Number.isFinite(quantity)) {
    return "Enter a quantity greater than zero.";
  }

  return null;
}

/**
 * Stable source key for duplicate consumption protection.
 */
export function consumptionSourceKey(
  sourceType: string,
  sourceId: string,
): string {
  return `${sourceType.trim()}:${sourceId.trim()}`;
}

/**
 * Reject duplicate consumption for the same source document line.
 */
export function assertUniqueConsumptionSource(
  sourceType: string,
  sourceId: string,
  alreadyAllocatedSourceKeys: readonly string[],
): string | null {
  const key = consumptionSourceKey(sourceType, sourceId);
  if (!sourceType.trim() || !sourceId.trim()) {
    return "Source id is required.";
  }

  if (alreadyAllocatedSourceKeys.includes(key)) {
    return "This item was already allocated.";
  }

  return null;
}

function sortFifo(batches: readonly FifoBatchCandidate[]): FifoBatchCandidate[] {
  return [...batches].sort((a, b) => {
    const byProducedAt = a.produced_at.localeCompare(b.produced_at);
    if (byProducedAt !== 0) {
      return byProducedAt;
    }
    return a.production_batch_id.localeCompare(b.production_batch_id);
  });
}

function toRemaining(
  batch: FifoBatchCandidate,
  remainingQuantity: number,
): FinishedGoodsBatchRemaining {
  return {
    production_batch_id: batch.production_batch_id,
    produced_quantity: batch.produced_quantity,
    remaining_quantity: remainingQuantity,
    unit_cost: batch.unit_cost,
    remaining_value: calculateRemainingValue(remainingQuantity, batch.unit_cost),
  };
}

/**
 * Plan FIFO batch consumption and project remaining quantity/value.
 * Unit costs are copied from batches — never recalculated.
 */
export function planFifoBatchConsumption(
  batches: readonly FifoBatchCandidate[],
  quantity: number,
):
  | { ok: true; plan: FinishedGoodsConsumptionPlan }
  | { ok: false; error: string } {
  const quantityError = validateConsumptionQuantity(quantity);
  if (quantityError) {
    return { ok: false, error: quantityError };
  }

  const ordered = sortFifo(batches);
  const remainingByBatch = new Map<string, number>();

  for (const batch of ordered) {
    if (!Number.isFinite(batch.available_quantity) || batch.available_quantity < 0) {
      return {
        ok: false,
        error: "Finished goods data is inconsistent. Contact support.",
      };
    }
    remainingByBatch.set(batch.production_batch_id, batch.available_quantity);
  }

  const availableTotal = ordered.reduce(
    (sum, batch) => sum + Math.max(0, batch.available_quantity),
    0,
  );

  if (ordered.length === 0 || availableTotal <= 0) {
    return { ok: false, error: "Not enough finished goods in stock." };
  }

  if (quantity > availableTotal) {
    return { ok: false, error: "Not enough finished goods in stock." };
  }

  const layers: FinishedGoodsConsumptionLayer[] = [];
  let remainingToAllocate = quantity;

  for (const batch of ordered) {
    if (remainingToAllocate <= 0) {
      break;
    }

    const batchRemaining = remainingByBatch.get(batch.production_batch_id) ?? 0;
    if (batchRemaining <= 0) {
      continue;
    }

    const take = Math.min(batchRemaining, remainingToAllocate);
    layers.push({
      production_batch_id: batch.production_batch_id,
      quantity: take,
      unit_cost: batch.unit_cost,
      produced_at: batch.produced_at,
    });

    remainingByBatch.set(batch.production_batch_id, batchRemaining - take);
    remainingToAllocate -= take;
  }

  if (remainingToAllocate > 0) {
    return { ok: false, error: "Not enough finished goods in stock." };
  }

  const remaining_after = ordered.map((batch) =>
    toRemaining(batch, remainingByBatch.get(batch.production_batch_id) ?? 0),
  );

  return {
    ok: true,
    plan: {
      layers,
      remaining_after,
    },
  };
}

/**
 * Apply planned consumption layers to batch remaining (projection only).
 * Preserves immutable unit_cost on every batch.
 */
export function projectRemainingAfterConsumption(
  batches: readonly FifoBatchCandidate[],
  layers: readonly FinishedGoodsConsumptionLayer[],
):
  | { ok: true; remaining: FinishedGoodsBatchRemaining[] }
  | { ok: false; error: string } {
  const ordered = sortFifo(batches);
  const remainingByBatch = new Map<string, number>();
  const batchById = new Map(
    ordered.map((batch) => [batch.production_batch_id, batch]),
  );

  for (const batch of ordered) {
    remainingByBatch.set(batch.production_batch_id, batch.available_quantity);
  }

  for (const layer of layers) {
    const batch = batchById.get(layer.production_batch_id);
    if (!batch) {
      return {
        ok: false,
        error: "Finished goods data is inconsistent. Contact support.",
      };
    }

    if (layer.unit_cost !== batch.unit_cost) {
      return {
        ok: false,
        error: "Finished goods batch unit cost is immutable after completion.",
      };
    }

    const current = remainingByBatch.get(layer.production_batch_id) ?? 0;
    if (layer.quantity > current) {
      return { ok: false, error: "Not enough finished goods in stock." };
    }

    remainingByBatch.set(layer.production_batch_id, current - layer.quantity);
  }

  return {
    ok: true,
    remaining: ordered.map((batch) =>
      toRemaining(batch, remainingByBatch.get(batch.production_batch_id) ?? 0),
    ),
  };
}

/**
 * Inventory cost of a consumption layer (qty × frozen unit cost).
 * Not sale COGS reporting — valuation movement only.
 */
export function consumptionLayerInventoryCost(
  layer: Pick<FinishedGoodsConsumptionLayer, "quantity" | "unit_cost">,
): number {
  return calculateMoneyLineTotal(layer.quantity, layer.unit_cost);
}
