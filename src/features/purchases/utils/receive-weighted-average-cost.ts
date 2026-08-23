/**
 * Mirrors sql/105_receive_purchase_line_stock_and_cost.sql.
 * Source of truth at Receive time is the Postgres RPC; this helper exists
 * so the four protective cases can be unit-tested without a live database.
 */

export const RECEIVE_COST_SKIP_WARNING =
  "Purchase line net unit cost is missing or not positive; stock increased without updating cost_per_unit.";

export interface ReceiveWeightedAverageInput {
  currentStock: number | null;
  oldCostPerUnit: number | null;
  quantity: number;
  netUnitCost: number | null;
}

export interface ReceiveWeightedAverageResult {
  newCostPerUnit: number | null;
  costUpdated: boolean;
  warning: string | null;
}

function roundCostPerUnit(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export function nextReceiveCostPerUnit(
  input: ReceiveWeightedAverageInput,
): ReceiveWeightedAverageResult {
  if (input.netUnitCost === null || input.netUnitCost <= 0) {
    return {
      newCostPerUnit: input.oldCostPerUnit,
      costUpdated: false,
      warning: RECEIVE_COST_SKIP_WARNING,
    };
  }

  const stockForAverage = Math.max(input.currentStock ?? 0, 0);
  const numerator =
    stockForAverage * (input.oldCostPerUnit ?? 0) +
    input.quantity * input.netUnitCost;
  const newCostPerUnit = roundCostPerUnit(
    numerator / (stockForAverage + input.quantity),
  );

  return {
    newCostPerUnit,
    costUpdated: true,
    warning: null,
  };
}
