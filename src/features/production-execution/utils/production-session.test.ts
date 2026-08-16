import { describe, expect, it } from "vitest";
import {
  canFinishProductionSession,
  computeLineDifference,
  hasAllProducedQuantities,
  parseProducedQuantityInput,
  parseRawMaterialScaleInput,
  validateProducedQuantity,
  validateRawMaterialScale,
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

describe("parseRawMaterialScaleInput", () => {
  it("treats empty as not entered", () => {
    expect(parseRawMaterialScaleInput("")).toEqual({ ok: true, value: null });
    expect(parseRawMaterialScaleInput("   ")).toEqual({
      ok: true,
      value: null,
    });
  });

  it("accepts a positive number of recipe batches", () => {
    expect(parseRawMaterialScaleInput("1")).toEqual({ ok: true, value: 1 });
    expect(parseRawMaterialScaleInput("1.5")).toEqual({
      ok: true,
      value: 1.5,
    });
  });

  it("rejects zero, negative, and non-numeric values", () => {
    expect(parseRawMaterialScaleInput("0")).toEqual({
      ok: false,
      error: "Recipe batches used must be greater than zero.",
    });
    expect(parseRawMaterialScaleInput("-1")).toEqual({
      ok: false,
      error: "Recipe batches used must be greater than zero.",
    });
    expect(parseRawMaterialScaleInput("abc")).toEqual({
      ok: false,
      error: "Enter a valid number of recipe batches.",
    });
  });
});

describe("validateRawMaterialScale", () => {
  it("allows null", () => {
    expect(validateRawMaterialScale(null)).toBeNull();
  });

  it("accepts a positive number", () => {
    expect(validateRawMaterialScale(1)).toBeNull();
    expect(validateRawMaterialScale(0.5)).toBeNull();
  });

  it("rejects zero and negatives", () => {
    expect(validateRawMaterialScale(0)).toBe(
      "Recipe batches used must be greater than zero.",
    );
    expect(validateRawMaterialScale(-0.1)).toBe(
      "Recipe batches used must be greater than zero.",
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
        {
          line_id: "a",
          actual_produced_quantity: null,
          raw_material_scale: null,
        },
      ]),
    ).toBe(
      "Enter an actual produced quantity for every product before finishing.",
    );
  });

  it("accepts zero and over-plan quantities", () => {
    expect(
      validateSessionLinesForComplete([
        {
          line_id: "a",
          actual_produced_quantity: 0,
          raw_material_scale: null,
        },
        {
          line_id: "b",
          actual_produced_quantity: 200,
          raw_material_scale: null,
        },
      ]),
    ).toBeNull();
  });
});
