/**
 * Sales Profit builder coverage (DEV-110).
 */

import { describe, expect, it } from "vitest";
import {
  assertSaleProfitImmutable,
  assertUniqueSaleProfitGeneration,
  buildSaleProfitSummary,
} from "./sale-profit-builder";

describe("sale-profit-builder (DEV-110)", () => {
  it("builds profitable sale profit from frozen net revenue and COGS", () => {
    const result = buildSaleProfitSummary({
      sale_id: "sale-1",
      sale_status: "confirmed",
      net_revenue: 100,
      cogs: 40,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.summary.net_revenue).toBe(100);
    expect(result.summary.cogs).toBe(40);
    expect(result.summary.gross_profit).toBe(60);
    expect(result.summary.gross_margin_percent).toBe(60);
    expect(result.summary.is_frozen).toBe(true);
  });

  it("supports zero profit (zero margin)", () => {
    const result = buildSaleProfitSummary({
      sale_id: "sale-1",
      sale_status: "paid",
      net_revenue: 50,
      cogs: 50,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.summary.gross_profit).toBe(0);
    expect(result.summary.gross_margin_percent).toBe(0);
  });

  it("supports negative profit", () => {
    const result = buildSaleProfitSummary({
      sale_id: "sale-1",
      sale_status: "confirmed",
      net_revenue: 30,
      cogs: 55,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.summary.gross_profit).toBe(-25);
    expect(result.summary.gross_margin_percent).toBe(-83.33);
  });

  it("supports zero revenue (margin undefined)", () => {
    const result = buildSaleProfitSummary({
      sale_id: "sale-1",
      sale_status: "confirmed",
      net_revenue: 0,
      cogs: 10,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.summary.net_revenue).toBe(0);
    expect(result.summary.gross_profit).toBe(-10);
    expect(result.summary.gross_margin_percent).toBeNull();
  });

  it("supports zero COGS", () => {
    const result = buildSaleProfitSummary({
      sale_id: "sale-1",
      sale_status: "confirmed",
      net_revenue: 80,
      cogs: 0,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.summary.gross_profit).toBe(80);
    expect(result.summary.gross_margin_percent).toBe(100);
  });

  it("rejects duplicate profit generation for the same sale", () => {
    expect(
      assertUniqueSaleProfitGeneration("sale-1", ["sale-1"]),
    ).toMatch(/already been generated/i);

    const result = buildSaleProfitSummary({
      sale_id: "sale-1",
      sale_status: "confirmed",
      net_revenue: 100,
      cogs: 40,
      alreadyBuiltSaleIds: ["sale-1"],
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toMatch(/already been generated/i);
  });

  it("rejects draft sales", () => {
    const result = buildSaleProfitSummary({
      sale_id: "sale-1",
      sale_status: "draft",
      net_revenue: 100,
      cogs: 40,
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toMatch(/draft/i);
  });

  it("asserts immutable historical profit", () => {
    const first = buildSaleProfitSummary({
      sale_id: "sale-1",
      sale_status: "confirmed",
      net_revenue: 100,
      cogs: 40,
    });
    const second = buildSaleProfitSummary({
      sale_id: "sale-1",
      sale_status: "confirmed",
      net_revenue: 100,
      cogs: 50,
    });

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) {
      return;
    }

    expect(
      assertSaleProfitImmutable({
        previous: first.summary,
        next: second.summary,
      }),
    ).toMatch(/immutable/i);

    expect(
      assertSaleProfitImmutable({
        previous: first.summary,
        next: first.summary,
      }),
    ).toBeNull();
  });

  it("never uses gross (VAT-inclusive) revenue", () => {
    const result = buildSaleProfitSummary({
      sale_id: "sale-1",
      sale_status: "confirmed",
      net_revenue: 100,
      cogs: 40,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    // Builder only accepts net_revenue — VAT is never part of profit.
    expect(result.summary.net_revenue).toBe(100);
    expect(result.summary).not.toHaveProperty("tax_total");
    expect(result.summary).not.toHaveProperty("gross_amount");
  });
});
