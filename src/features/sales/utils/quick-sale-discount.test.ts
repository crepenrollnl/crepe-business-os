/**
 * Preview totals for Quick Sale header discount (matches sql/110 resolve).
 */

import { describe, expect, it } from "vitest";
import { resolveSaleHeaderDiscount } from "./quick-sale-discount";

describe("resolveSaleHeaderDiscount", () => {
  it("treats an empty value as no discount", () => {
    const result = resolveSaleHeaderDiscount({
      catalogGross: 16.35,
      type: "amount",
      value: null,
    });

    expect(result.error).toBeNull();
    expect(result.discountAmount).toBe(0);
    expect(result.payable).toBe(16.35);
  });

  it("resolves a fixed amount that does not divide the catalog evenly", () => {
    const result = resolveSaleHeaderDiscount({
      catalogGross: 16.35,
      type: "amount",
      value: 1,
    });

    expect(result.error).toBeNull();
    expect(result.discountAmount).toBe(1);
    expect(result.payable).toBe(15.35);
  });

  it("resolves a percent of catalog gross", () => {
    const result = resolveSaleHeaderDiscount({
      catalogGross: 21.8,
      type: "percent",
      value: 10,
    });

    expect(result.error).toBeNull();
    expect(result.discountAmount).toBe(2.18);
    expect(result.payable).toBe(19.62);
  });

  it("rejects an amount larger than the catalog", () => {
    const result = resolveSaleHeaderDiscount({
      catalogGross: 10,
      type: "amount",
      value: 10.01,
    });

    expect(result.error).toBe("Discount cannot exceed the sale total.");
    expect(result.payable).toBe(10);
  });
});
