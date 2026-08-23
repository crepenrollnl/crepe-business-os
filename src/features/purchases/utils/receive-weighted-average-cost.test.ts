import { describe, expect, it } from "vitest";
import {
  RECEIVE_COST_SKIP_WARNING,
  nextReceiveCostPerUnit,
} from "./receive-weighted-average-cost";

describe("nextReceiveCostPerUnit (sql/105 moving weighted average)", () => {
  it("blends on-hand stock with the receipt when the warehouse is not empty", () => {
    const result = nextReceiveCostPerUnit({
      currentStock: 10,
      oldCostPerUnit: 5,
      quantity: 10,
      netUnitCost: 7,
    });

    expect(result).toEqual({
      newCostPerUnit: 6,
      costUpdated: true,
      warning: null,
    });
  });

  it("uses the purchase net unit cost when on-hand stock is 0", () => {
    const result = nextReceiveCostPerUnit({
      currentStock: 0,
      oldCostPerUnit: 12.5,
      quantity: 8,
      netUnitCost: 3,
    });

    expect(result).toEqual({
      newCostPerUnit: 3,
      costUpdated: true,
      warning: null,
    });
  });

  it("treats negative current_stock as 0 in the average (GREATEST guard)", () => {
    const result = nextReceiveCostPerUnit({
      currentStock: -4,
      oldCostPerUnit: 10,
      quantity: 6,
      netUnitCost: 2,
    });

    expect(result).toEqual({
      newCostPerUnit: 2,
      costUpdated: true,
      warning: null,
    });
  });

  it("leaves cost_per_unit unchanged when net_unit_cost is NULL", () => {
    const result = nextReceiveCostPerUnit({
      currentStock: 10,
      oldCostPerUnit: 9,
      quantity: 5,
      netUnitCost: null,
    });

    expect(result).toEqual({
      newCostPerUnit: 9,
      costUpdated: false,
      warning: RECEIVE_COST_SKIP_WARNING,
    });
  });

  it("leaves cost_per_unit unchanged when net_unit_cost is 0", () => {
    const result = nextReceiveCostPerUnit({
      currentStock: 10,
      oldCostPerUnit: 9,
      quantity: 5,
      netUnitCost: 0,
    });

    expect(result).toEqual({
      newCostPerUnit: 9,
      costUpdated: false,
      warning: RECEIVE_COST_SKIP_WARNING,
    });
  });
});
