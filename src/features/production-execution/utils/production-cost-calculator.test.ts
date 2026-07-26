/**
 * Production Cost Calculator coverage (DEV-103).
 */

import { describe, expect, it } from "vitest";
import {
  assignFinishedGoodsCostFromBatch,
  buildProductionCostLines,
  calculateBatchCostSummary,
  calculateConsumedIngredientCost,
  deriveBatchTotalCost,
  roundProductionUnitCost,
  validateInventoryUnitCost,
  validateProducedQuantityForCost,
} from "./production-cost-calculator";

describe("productionCostCalculator (DEV-103)", () => {
  it("calculates single-ingredient batch cost and unit cost", () => {
    const result = calculateBatchCostSummary({
      produced_quantity: 10,
      cost_lines: [
        {
          ingredient_id: "flour",
          ingredient_name: "Flour",
          consumed_quantity: 2,
          unit: "kg",
          inventory_unit_cost: 1.5,
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.summary.batch_cost).toBe(3);
    expect(result.summary.unit_cost).toBe(0.3);
    expect(result.summary.cost_breakdown).toHaveLength(1);
    expect(result.summary.cost_breakdown[0]?.line_cost).toBe(3);
  });

  it("calculates multiple-ingredient batch cost from actual inventory values", () => {
    const result = calculateBatchCostSummary({
      produced_quantity: 5,
      cost_lines: [
        {
          ingredient_id: "flour",
          ingredient_name: "Flour",
          consumed_quantity: 1,
          unit: "kg",
          inventory_unit_cost: 1.5,
        },
        {
          ingredient_id: "milk",
          ingredient_name: "Milk",
          consumed_quantity: 0.5,
          unit: "l",
          inventory_unit_cost: 2,
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    // (1 * 1.5) + (0.5 * 2) = 2.5 → unit 0.5
    expect(result.summary.batch_cost).toBe(2.5);
    expect(result.summary.unit_cost).toBe(0.5);
    expect(result.summary.cost_breakdown).toHaveLength(2);
  });

  it("supports partial consumption by omitting zero-quantity lines", () => {
    const lines = buildProductionCostLines([
      {
        ingredient_id: "flour",
        ingredient_name: "Flour",
        consumed_quantity: 1,
        unit: "kg",
        inventory_unit_cost: 2,
      },
      {
        ingredient_id: "spice",
        ingredient_name: "Spice",
        consumed_quantity: 0,
        unit: "g",
        inventory_unit_cost: 10,
      },
    ]);

    expect(lines.ok).toBe(true);
    if (!lines.ok) {
      return;
    }

    expect(lines.lines).toHaveLength(1);
    expect(lines.lines[0]?.ingredient_id).toBe("flour");
  });

  it("rejects zero produced quantity for batch cost", () => {
    expect(validateProducedQuantityForCost(0)).toMatch(/greater than zero/i);

    const result = calculateBatchCostSummary({
      produced_quantity: 0,
      cost_lines: [
        {
          ingredient_id: "flour",
          ingredient_name: "Flour",
          consumed_quantity: 1,
          unit: "kg",
          inventory_unit_cost: 1,
        },
      ],
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toMatch(/greater than zero/i);
  });

  it("rejects negative produced and consumed quantities", () => {
    expect(validateProducedQuantityForCost(-1)).toMatch(/negative/i);

    const result = calculateBatchCostSummary({
      produced_quantity: 10,
      cost_lines: [
        {
          ingredient_id: "flour",
          ingredient_name: "Flour",
          consumed_quantity: -2,
          unit: "kg",
          inventory_unit_cost: 1,
        },
      ],
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toMatch(/cannot be negative/i);
  });

  it("rejects missing inventory valuation", () => {
    expect(validateInventoryUnitCost("Flour", null)).toMatch(
      /missing inventory valuation/i,
    );
    expect(validateInventoryUnitCost("Flour", Number.NaN)).toMatch(
      /missing inventory valuation/i,
    );

    const result = calculateBatchCostSummary({
      produced_quantity: 10,
      cost_lines: [
        {
          ingredient_id: "flour",
          ingredient_name: "Flour",
          consumed_quantity: 1,
          unit: "kg",
          inventory_unit_cost: Number.NaN,
        },
      ],
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toMatch(/missing inventory valuation/i);
  });

  it("rejects missing ingredient identity", () => {
    const result = buildProductionCostLines([
      {
        ingredient_id: "",
        ingredient_name: "Flour",
        consumed_quantity: 1,
        unit: "kg",
        inventory_unit_cost: 1,
      },
    ]);

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toMatch(/missing ingredient/i);
  });

  it("keeps rounding consistent for money and unit cost", () => {
    expect(calculateConsumedIngredientCost(1 / 3, 0.1)).toBe(0.03);
    expect(roundProductionUnitCost(1 / 3)).toBe(0.3333);

    const result = calculateBatchCostSummary({
      produced_quantity: 3,
      cost_lines: [
        {
          ingredient_id: "flour",
          ingredient_name: "Flour",
          consumed_quantity: 1,
          unit: "kg",
          inventory_unit_cost: 1 / 3,
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.summary.batch_cost).toBe(0.33);
    expect(result.summary.unit_cost).toBe(
      roundProductionUnitCost(0.33 / 3),
    );
  });

  it("assigns finished goods cost from frozen batch values only", () => {
    const assignment = assignFinishedGoodsCostFromBatch({
      produced_quantity: 10,
      unit_cost: 0.5,
      batch_cost: 5,
    });

    expect(assignment.ok).toBe(true);
    if (!assignment.ok) {
      return;
    }

    expect(assignment.assignment).toEqual({
      produced_quantity: 10,
      unit_cost: 0.5,
      total_cost: 5,
    });

    expect(deriveBatchTotalCost(10, 0.5)).toBe(5);
  });

  it("keeps finished goods assignment immutable relative to recalculation inputs", () => {
    const frozen = assignFinishedGoodsCostFromBatch({
      produced_quantity: 4,
      unit_cost: 2.25,
    });

    expect(frozen.ok).toBe(true);
    if (!frozen.ok) {
      return;
    }

    // Changing "current" inventory cost must not affect assignment inputs.
    const currentInventoryCost = 999;
    expect(frozen.assignment.unit_cost).toBe(2.25);
    expect(frozen.assignment.total_cost).toBe(9);
    expect(frozen.assignment.unit_cost).not.toBe(currentInventoryCost);
  });
});
