/**
 * Finished Goods Inventory Valuation coverage (DEV-104).
 */

import { describe, expect, it } from "vitest";
import {
  assertFinishedGoodsValuationImmutable,
  assignFinishedGoodsInventoryValuation,
  calculateRemainingValue,
  findDuplicateFinishedGoodsValuations,
  validateFinishedGoodsValuationSource,
} from "./finished-goods-valuation";

describe("finishedGoodsValuation (DEV-104)", () => {
  it("assigns inventory valuation from a completed production batch", () => {
    const result = assignFinishedGoodsInventoryValuation({
      production_batch_id: "batch-1",
      produced_quantity: 10,
      available_quantity: 10,
      unit_cost: 0.5,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.valuation).toEqual({
      production_batch_id: "batch-1",
      produced_quantity: 10,
      remaining_quantity: 10,
      total_batch_cost: 5,
      unit_cost: 0.5,
      remaining_value: 5,
    });
  });

  it("updates remaining value when remaining quantity changes", () => {
    const full = assignFinishedGoodsInventoryValuation({
      production_batch_id: "batch-1",
      produced_quantity: 10,
      available_quantity: 10,
      unit_cost: 2.5,
    });
    const partial = assignFinishedGoodsInventoryValuation({
      production_batch_id: "batch-1",
      produced_quantity: 10,
      available_quantity: 4,
      unit_cost: 2.5,
    });

    expect(full.ok && partial.ok).toBe(true);
    if (!full.ok || !partial.ok) {
      return;
    }

    expect(full.valuation.remaining_quantity).toBe(10);
    expect(full.valuation.remaining_value).toBe(25);
    expect(partial.valuation.remaining_quantity).toBe(4);
    expect(partial.valuation.remaining_value).toBe(10);
    // Frozen unit cost / total batch cost do not change with remaining.
    expect(partial.valuation.unit_cost).toBe(full.valuation.unit_cost);
    expect(partial.valuation.total_batch_cost).toBe(
      full.valuation.total_batch_cost,
    );
  });

  it("keeps valuation immutable when unit cost would otherwise change", () => {
    expect(
      assertFinishedGoodsValuationImmutable({
        previous_unit_cost: 1.25,
        next_unit_cost: 1.25,
      }),
    ).toBeNull();

    expect(
      assertFinishedGoodsValuationImmutable({
        previous_unit_cost: 1.25,
        next_unit_cost: 9.99,
      }),
    ).toMatch(/immutable/i);
  });

  it("rejects duplicate valuation identities", () => {
    expect(
      findDuplicateFinishedGoodsValuations([
        { production_batch_id: "batch-1" },
        { production_batch_id: "batch-2" },
      ]),
    ).toBeNull();

    expect(
      findDuplicateFinishedGoodsValuations([
        { production_batch_id: "batch-1" },
        { production_batch_id: "batch-1" },
      ]),
    ).toMatch(/duplicate/i);
  });

  it("rejects zero produced quantity and negative quantities", () => {
    expect(
      validateFinishedGoodsValuationSource({
        production_batch_id: "batch-1",
        produced_quantity: 0,
        available_quantity: 0,
        unit_cost: 1,
      }),
    ).toMatch(/positive produced quantity/i);

    expect(
      validateFinishedGoodsValuationSource({
        production_batch_id: "batch-1",
        produced_quantity: 10,
        available_quantity: -1,
        unit_cost: 1,
      }),
    ).toMatch(/cannot be negative/i);

    expect(
      validateFinishedGoodsValuationSource({
        production_batch_id: "batch-1",
        produced_quantity: 10,
        available_quantity: 11,
        unit_cost: 1,
      }),
    ).toMatch(/cannot exceed produced/i);
  });

  it("allows zero cost as a valid frozen valuation", () => {
    const result = assignFinishedGoodsInventoryValuation({
      production_batch_id: "batch-1",
      produced_quantity: 5,
      available_quantity: 5,
      unit_cost: 0,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.valuation.unit_cost).toBe(0);
    expect(result.valuation.total_batch_cost).toBe(0);
    expect(result.valuation.remaining_value).toBe(0);
  });

  it("calculates remaining value from frozen unit cost only", () => {
    expect(calculateRemainingValue(3, 2.5)).toBe(7.5);
  });
});
