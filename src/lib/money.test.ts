import { describe, expect, it } from "vitest";
import { calculateMoneyLineTotal, formatMoney, formatUnitCost, roundMoney } from "./money";

describe("formatMoney", () => {
  it("formats a positive amount with the EU thousands separator", () => {
    expect(formatMoney(12345.6)).toBe("€12,345.60");
  });

  it("formats zero", () => {
    expect(formatMoney(0)).toBe("€0.00");
  });

  it("formats a negative amount with the sign before the currency symbol", () => {
    expect(formatMoney(-5.5)).toBe("-€5.50");
  });

  it("rounds to 2 decimal places for display", () => {
    expect(formatMoney(1.005)).toBe("€1.01");
  });
});

describe("formatUnitCost", () => {
  it("formats to 4 decimal places", () => {
    expect(formatUnitCost(0.1234)).toBe("€0.1234");
  });

  it("does not collapse small fractional costs to zero", () => {
    expect(formatUnitCost(0.0025)).toBe("€0.0025");
  });

  it("pads whole numbers to 4 decimal places", () => {
    expect(formatUnitCost(12.5)).toBe("€12.5000");
  });
});

describe("roundMoney / calculateMoneyLineTotal (unchanged behavior)", () => {
  it("rounds to the platform money precision", () => {
    expect(roundMoney(19.999)).toBe(20);
  });

  it("multiplies quantity by unit amount and rounds", () => {
    expect(calculateMoneyLineTotal(3, 1.1)).toBe(3.3);
  });
});
