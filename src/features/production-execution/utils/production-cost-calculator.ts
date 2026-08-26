/**
 * Production Cost Calculator (DEV-103).
 *
 * Single owner for production batch cost math.
 * Uses actual consumed quantity × actual inventory unit cost only.
 * Never uses recipe prices or estimates.
 *
 * Official batch costs are frozen at Production Completion (immutable).
 */

import { calculateMoneyLineTotal, roundMoney } from "@/lib/money";
import { roundQuantity } from "@/lib/quantity";

/** One consumed ingredient contributing to a batch cost. */
export interface ProductionCostLineInput {
  ingredient_id: string;
  ingredient_name: string;
  /** Actual consumed quantity for this batch. */
  consumed_quantity: number;
  unit: string;
  /** Actual inventory unit cost at consumption time. */
  inventory_unit_cost: number;
}

export interface ProductionCostLine {
  ingredient_id: string;
  ingredient_name: string;
  consumed_quantity: number;
  unit: string;
  inventory_unit_cost: number;
  line_cost: number;
}

export interface BatchCostSummary {
  produced_quantity: number;
  /** Sum of (consumed qty × inventory unit cost). */
  batch_cost: number;
  /** batch_cost / produced_quantity. */
  unit_cost: number;
  cost_breakdown: readonly ProductionCostLine[];
}

/**
 * Finished Goods cost assignment derived from an immutable Production Batch.
 * FG never recalculates — it uses the frozen batch unit_cost.
 */
export interface FinishedGoodsCostAssignment {
  produced_quantity: number;
  unit_cost: number;
  total_cost: number;
}

export function roundProductionUnitCost(value: number): number {
  const factor = 10 ** 4;
  return Math.round(value * factor) / factor;
}

/**
 * Validate a single inventory unit cost for production costing.
 */
export function validateInventoryUnitCost(
  ingredientName: string,
  unitCost: number | null | undefined,
): string | null {
  if (unitCost === null || unitCost === undefined) {
    return `Missing inventory valuation for "${ingredientName}".`;
  }

  if (!Number.isFinite(unitCost)) {
    return `Missing inventory valuation for "${ingredientName}".`;
  }

  if (unitCost < 0) {
    return `Inventory unit cost for "${ingredientName}" cannot be negative.`;
  }

  if (unitCost === 0) {
    return `Missing inventory valuation for "${ingredientName}".`;
  }

  return null;
}

/**
 * Validate produced quantity for batch cost calculation.
 */
export function validateProducedQuantityForCost(
  producedQuantity: number,
): string | null {
  if (!Number.isFinite(producedQuantity)) {
    return "Produced quantity is invalid.";
  }

  if (producedQuantity < 0) {
    return "Produced quantity cannot be negative.";
  }

  if (producedQuantity === 0) {
    return "Produced quantity must be greater than zero to calculate batch cost.";
  }

  return null;
}

/**
 * Cost for one consumed ingredient line.
 * Formula: actual consumed quantity × actual inventory unit cost.
 */
export function calculateConsumedIngredientCost(
  consumedQuantity: number,
  inventoryUnitCost: number,
): number {
  return calculateMoneyLineTotal(consumedQuantity, inventoryUnitCost);
}

/**
 * Validate and normalize cost lines before aggregating a batch.
 */
export function buildProductionCostLines(
  lines: readonly ProductionCostLineInput[],
): { ok: true; lines: ProductionCostLine[] } | { ok: false; error: string } {
  const result: ProductionCostLine[] = [];

  for (const line of lines) {
    if (!line.ingredient_id || line.ingredient_id.trim().length === 0) {
      return { ok: false, error: "Missing ingredient for production cost." };
    }

    if (!Number.isFinite(line.consumed_quantity)) {
      return {
        ok: false,
        error: `Consumed quantity for "${line.ingredient_name}" is invalid.`,
      };
    }

    if (line.consumed_quantity < 0) {
      return {
        ok: false,
        error: `Consumed quantity for "${line.ingredient_name}" cannot be negative.`,
      };
    }

    // Partial consumption: zero qty lines are omitted (not an error).
    if (line.consumed_quantity === 0) {
      continue;
    }

    const valuationError = validateInventoryUnitCost(
      line.ingredient_name,
      line.inventory_unit_cost,
    );
    if (valuationError) {
      return { ok: false, error: valuationError };
    }

    const consumedQuantity = roundQuantity(line.consumed_quantity);
    const inventoryUnitCost = roundProductionUnitCost(line.inventory_unit_cost);

    result.push({
      ingredient_id: line.ingredient_id,
      ingredient_name: line.ingredient_name,
      consumed_quantity: consumedQuantity,
      unit: line.unit,
      inventory_unit_cost: inventoryUnitCost,
      line_cost: calculateConsumedIngredientCost(
        consumedQuantity,
        inventoryUnitCost,
      ),
    });
  }

  result.sort((a, b) => a.ingredient_name.localeCompare(b.ingredient_name));
  return { ok: true, lines: result };
}

/**
 * Batch Cost = Σ (actual consumed qty × actual inventory unit cost)
 * Unit Cost = Batch Cost / Produced Quantity
 */
export function calculateBatchCostSummary(input: {
  produced_quantity: number;
  cost_lines: readonly ProductionCostLineInput[];
}): { ok: true; summary: BatchCostSummary } | { ok: false; error: string } {
  const producedError = validateProducedQuantityForCost(input.produced_quantity);
  if (producedError) {
    return { ok: false, error: producedError };
  }

  const linesResult = buildProductionCostLines(input.cost_lines);
  if (!linesResult.ok) {
    return linesResult;
  }

  const batchCost = roundMoney(
    linesResult.lines.reduce((sum, line) => sum + line.line_cost, 0),
  );
  const unitCost = roundProductionUnitCost(
    batchCost / input.produced_quantity,
  );

  return {
    ok: true,
    summary: {
      produced_quantity: input.produced_quantity,
      batch_cost: batchCost,
      unit_cost: unitCost,
      cost_breakdown: linesResult.lines,
    },
  };
}

/**
 * Assign Finished Goods cost from an immutable Production Batch.
 * Does not recalculate from inventory or recipes.
 */
export function assignFinishedGoodsCostFromBatch(batch: {
  produced_quantity: number;
  unit_cost: number;
  /** Optional stored/derived total; recomputed from unit_cost when omitted. */
  batch_cost?: number;
}):
  | { ok: true; assignment: FinishedGoodsCostAssignment }
  | { ok: false; error: string } {
  if (!Number.isFinite(batch.produced_quantity) || batch.produced_quantity <= 0) {
    return {
      ok: false,
      error: "Finished goods assignment requires a positive produced quantity.",
    };
  }

  if (!Number.isFinite(batch.unit_cost) || batch.unit_cost < 0) {
    return {
      ok: false,
      error: "Finished goods assignment requires a valid frozen unit cost.",
    };
  }

  const totalCost =
    batch.batch_cost !== undefined
      ? roundMoney(batch.batch_cost)
      : roundMoney(batch.produced_quantity * batch.unit_cost);

  return {
    ok: true,
    assignment: {
      produced_quantity: batch.produced_quantity,
      unit_cost: roundProductionUnitCost(batch.unit_cost),
      total_cost: totalCost,
    },
  };
}

/**
 * Derive official batch total from frozen unit_cost (no recalculation).
 */
export function deriveBatchTotalCost(
  producedQuantity: number,
  unitCost: number,
): number {
  return roundMoney(producedQuantity * unitCost);
}
