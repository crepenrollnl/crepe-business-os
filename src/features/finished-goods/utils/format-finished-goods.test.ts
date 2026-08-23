import { describe, expect, it } from "vitest";
import { formatFinishedGoodsAvailable } from "./format-finished-goods";

describe("formatFinishedGoodsAvailable", () => {
  it("includes the yield unit when present", () => {
    expect(formatFinishedGoodsAvailable(7, "kg")).toBe("7 kg");
  });

  it("omits the unit when missing", () => {
    expect(formatFinishedGoodsAvailable(7, null)).toBe("7");
  });

  it("trims trailing zeros on fractional quantities", () => {
    expect(formatFinishedGoodsAvailable(2.5, "kg")).toBe("2.5 kg");
  });
});
