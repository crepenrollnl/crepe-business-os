import { describe, expect, it } from "vitest";
import {
  canFinishProductionSession,
  computeLineDifference,
  hasAllProducedQuantities,
  parseProducedQuantityInput,
  validateProducedQuantity,
  validateSessionLinesForComplete,
} from "./production-session";

describe("computeLineDifference", () => {
  it("returns null when actual is not entered", () => {
    expect(computeLineDifference(100, null)).toBeNull();
  });

  it("returns actual minus planned", () => {
    expect(computeLineDifference(100, 96)).toBe(-4);
    expect(computeLineDifference(100, 100)).toBe(0);
    expect(computeLineDifference(100, 110)).toBe(10);
  });
});

describe("parseProducedQuantityInput", () => {
  it("treats empty as not entered", () => {
    expect(parseProducedQuantityInput("")).toEqual({ ok: true, value: null });
    expect(parseProducedQuantityInput("   ")).toEqual({
      ok: true,
      value: null,
    });
  });

  it("allows zero and values above planned", () => {
    expect(parseProducedQuantityInput("0")).toEqual({ ok: true, value: 0 });
    expect(parseProducedQuantityInput("150")).toEqual({
      ok: true,
      value: 150,
    });
  });

  it("rejects negative and non-numeric values", () => {
    expect(parseProducedQuantityInput("-1")).toEqual({
      ok: false,
      error: "Produced quantity cannot be negative.",
    });
    expect(parseProducedQuantityInput("abc").ok).toBe(false);
  });
});

describe("validateProducedQuantity", () => {
  it("allows null and zero", () => {
    expect(validateProducedQuantity(null)).toBeNull();
    expect(validateProducedQuantity(0)).toBeNull();
  });

  it("rejects negatives", () => {
    expect(validateProducedQuantity(-0.1)).toBe(
      "Produced quantity cannot be negative.",
    );
  });
});

describe("canFinishProductionSession", () => {
  it("requires every line to have an actual quantity", () => {
    expect(
      canFinishProductionSession([
        { actual_produced_quantity: 10 },
        { actual_produced_quantity: null },
      ]),
    ).toBe(false);

    expect(
      canFinishProductionSession([
        { actual_produced_quantity: 10 },
        { actual_produced_quantity: 0 },
      ]),
    ).toBe(true);
  });

  it("rejects empty line lists", () => {
    expect(hasAllProducedQuantities([])).toBe(false);
    expect(canFinishProductionSession([])).toBe(false);
  });
});

describe("validateSessionLinesForComplete", () => {
  it("requires all produced quantities", () => {
    expect(
      validateSessionLinesForComplete([
        { line_id: "a", actual_produced_quantity: null },
      ]),
    ).toBe(
      "Enter an actual produced quantity for every product before finishing.",
    );
  });

  it("accepts zero and over-plan quantities", () => {
    expect(
      validateSessionLinesForComplete([
        { line_id: "a", actual_produced_quantity: 0 },
        { line_id: "b", actual_produced_quantity: 200 },
      ]),
    ).toBeNull();
  });
});
