/**
 * Finished Goods Inventory Valuation (DEV-104).
 *
 * Freeze-compliant:
 *   - unit_cost / total_batch_cost come from the immutable Production Batch
 *   - remaining_quantity is CALCULATED only (never stored)
 *   - remaining_value = remaining_quantity × frozen unit_cost
 *
 * Never recalculates unit_cost after completion.
 * Specs: docs/FINISHED_GOODS.md, docs/BATCH_CONSUMPTION.md, ARCHITECTURE_FREEZE_V1
 */

import { roundMoney } from "@/lib/money";

/**
 * Inventory lot valuation for one completed Production Batch.
 * Remaining quantity is a calculated projection — never persisted.
 */
export interface FinishedGoodsBatchValuation {
  production_batch_id: string;
  produced_quantity: number;
  /** Calculated: produced − consumed (+ returns). Never stored. */
  remaining_quantity: number;
  /** Frozen lot value: produced_quantity × unit_cost. */
  total_batch_cost: number;
  /** Frozen at production completion. */
  unit_cost: number;
  /** Calculated: remaining_quantity × unit_cost. */
  remaining_value: number;
}

export interface FinishedGoodsValuationSource {
  production_batch_id: string;
  produced_quantity: number;
  /** Calculated remaining / available quantity. */
  available_quantity: number;
  unit_cost: number;
  /** Optional SQL-provided totals; recalculated when omitted. */
  total_batch_cost?: number;
  remaining_value?: number;
}

function roundUnitCost(value: number): number {
  const factor = 10 ** 4;
  return Math.round(value * factor) / factor;
}

/**
 * Validate frozen batch facts before valuation assignment.
 */
export function validateFinishedGoodsValuationSource(
  source: FinishedGoodsValuationSource,
): string | null {
  if (!source.production_batch_id?.trim()) {
    return "Production batch id is required for valuation.";
  }

  if (!Number.isFinite(source.produced_quantity)) {
    return "Produced quantity is invalid.";
  }

  if (source.produced_quantity <= 0) {
    return "Finished goods valuation requires a positive produced quantity.";
  }

  if (!Number.isFinite(source.available_quantity)) {
    return "Remaining quantity is invalid.";
  }

  if (source.available_quantity < 0) {
    return "Remaining quantity cannot be negative.";
  }

  if (source.available_quantity > source.produced_quantity) {
    return "Remaining quantity cannot exceed produced quantity.";
  }

  if (!Number.isFinite(source.unit_cost)) {
    return "Unit cost is invalid.";
  }

  if (source.unit_cost < 0) {
    return "Unit cost cannot be negative.";
  }

  return null;
}

/**
 * Assign Finished Goods inventory valuation from a completed production batch.
 * Does not recalculate unit_cost. Remaining is projection-only.
 */
export function assignFinishedGoodsInventoryValuation(
  source: FinishedGoodsValuationSource,
):
  | { ok: true; valuation: FinishedGoodsBatchValuation }
  | { ok: false; error: string } {
  const validationError = validateFinishedGoodsValuationSource(source);
  if (validationError) {
    return { ok: false, error: validationError };
  }

  const unitCost = roundUnitCost(source.unit_cost);
  const totalBatchCost =
    source.total_batch_cost !== undefined
      ? roundMoney(source.total_batch_cost)
      : roundMoney(source.produced_quantity * unitCost);

  const remainingQuantity = source.available_quantity;
  const remainingValue =
    source.remaining_value !== undefined
      ? roundMoney(source.remaining_value)
      : roundMoney(remainingQuantity * unitCost);

  return {
    ok: true,
    valuation: {
      production_batch_id: source.production_batch_id,
      produced_quantity: source.produced_quantity,
      remaining_quantity: remainingQuantity,
      total_batch_cost: totalBatchCost,
      unit_cost: unitCost,
      remaining_value: remainingValue,
    },
  };
}

/**
 * Detect duplicate valuation identities (one lot per production batch).
 */
export function findDuplicateFinishedGoodsValuations(
  valuations: readonly Pick<
    FinishedGoodsBatchValuation,
    "production_batch_id"
  >[],
): string | null {
  const seen = new Set<string>();

  for (const row of valuations) {
    const id = row.production_batch_id;
    if (seen.has(id)) {
      return `Duplicate finished goods valuation for batch ${id}.`;
    }
    seen.add(id);
  }

  return null;
}

/**
 * Assert historical valuation immutability: frozen unit_cost must not change.
 */
export function assertFinishedGoodsValuationImmutable(input: {
  previous_unit_cost: number;
  next_unit_cost: number;
}): string | null {
  if (input.previous_unit_cost !== input.next_unit_cost) {
    return "Finished goods batch unit cost is immutable after completion.";
  }

  return null;
}

/**
 * Pure remaining-value projection from frozen unit cost.
 */
export function calculateRemainingValue(
  remainingQuantity: number,
  unitCost: number,
): number {
  return roundMoney(remainingQuantity * unitCost);
}
