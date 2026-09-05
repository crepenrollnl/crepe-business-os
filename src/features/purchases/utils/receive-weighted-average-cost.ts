/**
 * Mirrors the moving weighted-average in
 * receive_purchase_line_stock_and_cost (sql/105, tightened by sql/111).
 * Source of truth at Receive time is the Postgres RPC; this helper exists
 * so the average formula can be unit-tested without a live database.
 *
 * sql/111 raises before the UPDATE when net unit cost is NULL or <= 0.
 * This helper throws on that input so tests cannot silently reintroduce
 * the skip-cost path.
 */

export interface ReceiveWeightedAverageInput {
  currentStock: number | null;
  oldCostPerUnit: number | null;
  quantity: number;
  netUnitCost: number | null;
}

function roundCostPerUnit(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export function nextReceiveCostPerUnit(
  input: ReceiveWeightedAverageInput,
): number {
  if (input.netUnitCost === null || input.netUnitCost <= 0) {
    throw new Error(
      "Purchase line net unit cost must be greater than zero.",
    );
  }

  const stockForAverage = Math.max(input.currentStock ?? 0, 0);
  const numerator =
    stockForAverage * (input.oldCostPerUnit ?? 0) +
    input.quantity * input.netUnitCost;

  return roundCostPerUnit(numerator / (stockForAverage + input.quantity));
}
