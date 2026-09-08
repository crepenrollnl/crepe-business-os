import { describe, expect, it } from "vitest";
import { computeRawMaterialScaleFromActual } from "./raw-material-scale-from-actual";

describe("computeRawMaterialScaleFromActual", () => {
  it("returns empty as a no-op without a scale", () => {
    expect(computeRawMaterialScaleFromActual("", 3)).toEqual({
      ok: true,
      kind: "empty",
    });
    expect(computeRawMaterialScaleFromActual("   ", 3)).toEqual({
      ok: true,
      kind: "empty",
    });
  });

  it("divides entered quantity by the declared recipe quantity", () => {
    expect(computeRawMaterialScaleFromActual("6", 3)).toEqual({
      ok: true,
      kind: "scale",
      scale: 2,
    });
    expect(computeRawMaterialScaleFromActual("3.15", 2.1)).toEqual({
      ok: true,
      kind: "scale",
      scale: 1.5,
    });
  });

  it("rejects zero, negative, and non-numeric entered quantities", () => {
    expect(computeRawMaterialScaleFromActual("0", 3)).toEqual({
      ok: false,
      error: "Quantity must be greater than zero.",
    });
    expect(computeRawMaterialScaleFromActual("-1", 3)).toEqual({
      ok: false,
      error: "Quantity must be greater than zero.",
    });
    expect(computeRawMaterialScaleFromActual("abc", 3)).toEqual({
      ok: false,
      error: "Enter a valid quantity.",
    });
  });

  it("rejects a missing or non-positive declared recipe quantity", () => {
    expect(computeRawMaterialScaleFromActual("6", 0)).toEqual({
      ok: false,
      error: "Recipe quantity for this ingredient is invalid.",
    });
    expect(computeRawMaterialScaleFromActual("6", Number.NaN)).toEqual({
      ok: false,
      error: "Recipe quantity for this ingredient is invalid.",
    });
  });
});
