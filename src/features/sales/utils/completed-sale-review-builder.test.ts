/**
 * Completed Sale Review reconciliation coverage (V1 plan 1.8 follow-up).
 */

import { describe, expect, it } from "vitest";
import type { SaleCostSummary } from "../types/sale-cogs";
import type { SaleProfitSummary } from "../types/sale-profit";
import {
  COGS_UNVERIFIED_MESSAGE,
  reconcileCompletedSaleReview,
} from "./completed-sale-review-builder";

const SALE_ID = "11111111-1111-4111-8111-111111111111";

function cogsSummary(overrides?: Partial<SaleCostSummary>): SaleCostSummary {
  return {
    sale_id: SALE_ID,
    total_cogs: 40,
    consumed_quantity: 5,
    layers: [],
    line_summaries: [],
    is_frozen: true,
    ...overrides,
  };
}

function profitSummary(
  overrides?: Partial<SaleProfitSummary>,
): SaleProfitSummary {
  return {
    sale_id: SALE_ID,
    net_revenue: 100,
    cogs: 40,
    gross_profit: 60,
    gross_margin_percent: 60,
    is_frozen: true,
    ...overrides,
  };
}

describe("reconcileCompletedSaleReview (V1 plan 1.8 follow-up)", () => {
  it("passes through both reads when profit succeeded", () => {
    const result = reconcileCompletedSaleReview({
      cogs: { data: cogsSummary(), error: null },
      profit: { data: profitSummary(), error: null },
    });

    expect(result.cogsSummary).toEqual(cogsSummary());
    expect(result.cogsError).toBeNull();
    expect(result.profitSummary).toEqual(profitSummary());
    expect(result.profitError).toBeNull();
  });

  it("passes through null/null for a sale that is not completed", () => {
    const result = reconcileCompletedSaleReview({
      cogs: { data: null, error: null },
      profit: { data: null, error: null },
    });

    expect(result).toEqual({
      cogsSummary: null,
      cogsError: null,
      profitSummary: null,
      profitError: null,
    });
  });

  it("hides COGS when profit failed server-side verification", () => {
    const result = reconcileCompletedSaleReview({
      cogs: { data: cogsSummary(), error: null },
      profit: {
        data: null,
        error:
          "Sale COGS and profit failed server-side verification and were not shown.",
      },
    });

    expect(result.cogsSummary).toBeNull();
    expect(result.cogsError).toBe(COGS_UNVERIFIED_MESSAGE);
    expect(result.profitSummary).toBeNull();
    expect(result.profitError).toBe(
      "Sale COGS and profit failed server-side verification and were not shown.",
    );
  });

  it("hides COGS when the verification RPC itself errored", () => {
    const result = reconcileCompletedSaleReview({
      cogs: { data: cogsSummary(), error: null },
      profit: { data: null, error: "connection refused" },
    });

    expect(result.cogsSummary).toBeNull();
    expect(result.cogsError).toBe(COGS_UNVERIFIED_MESSAGE);
    expect(result.profitError).toBe("connection refused");
  });

  it("hides COGS when profit failed for a genuine COGS-level reason", () => {
    // Profit re-derives COGS from the same ledger, so a real COGS failure
    // (e.g. no consumption layers) surfaces as a profit error too.
    const result = reconcileCompletedSaleReview({
      cogs: {
        data: null,
        error: "Sale has no Finished Goods consumption layers for COGS.",
      },
      profit: {
        data: null,
        error: "Sale has no Finished Goods consumption layers for COGS.",
      },
    });

    expect(result.cogsSummary).toBeNull();
    expect(result.cogsError).toBe(COGS_UNVERIFIED_MESSAGE);
  });

  it("does not blank COGS on its own unrelated error when profit succeeded", () => {
    // Defensive case: if COGS and profit ever diverge (e.g. a transient
    // blip on one of the two independent reads) without profit erroring,
    // COGS keeps reporting its own state rather than being silently hidden.
    const result = reconcileCompletedSaleReview({
      cogs: { data: null, error: "network error" },
      profit: { data: profitSummary(), error: null },
    });

    expect(result.cogsSummary).toBeNull();
    expect(result.cogsError).toBe("network error");
    expect(result.profitSummary).toEqual(profitSummary());
  });
});
