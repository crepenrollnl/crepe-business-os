/**
 * Documents the sql/109 COGS rounding contract in TS (same numbers as
 * tests/sql/get_sales_by_product.sql).
 */

import { describe, expect, it } from "vitest";
import { roundMoney } from "@/lib/money";

describe("sales-by-product COGS rounding (sql/109)", () => {
  it("rounds 1.004 + 1.004 once to 2.01, not 2.00 per sale", () => {
    expect(roundMoney(1.004) + roundMoney(1.004)).toBe(2);
    expect(roundMoney(1.004 + 1.004)).toBe(2.01);
  });
});
