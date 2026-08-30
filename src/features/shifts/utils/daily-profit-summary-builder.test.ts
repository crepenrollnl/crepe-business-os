/**
 * Pure builder coverage for Daily Profit Summary (DEV-115).
 */

import { describe, expect, it } from "vitest";
import type { DailyProfitSummary } from "../types/daily-profit-summary";
import type { Shift } from "../types/shift";
import {
  assertCanGenerateDailyProfitSummary,
  assertDailyProfitSummaryHistoricallyImmutable,
  assertDailyProfitSummaryNotDuplicate,
  buildDailyProfitSummary,
} from "./daily-profit-summary-builder";

const SHIFT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SALE_A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SALE_B = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SUMMARY_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function closedShift(overrides?: Partial<Shift>): Shift {
  return {
    id: SHIFT_ID,
    opened_at: "2026-07-26T08:00:00.000Z",
    closed_at: "2026-07-26T18:00:00.000Z",
    status: "closed",
    notes: null,
    created_at: "2026-07-26T08:00:00.000Z",
    ...overrides,
  };
}

function summary(overrides?: Partial<DailyProfitSummary>): DailyProfitSummary {
  return {
    id: SUMMARY_ID,
    shift_id: SHIFT_ID,
    net_revenue: 100,
    total_cogs: 40,
    gross_profit: 60,
    gross_margin_percent: 60,
    generated_at: "2026-07-26T18:00:00.000Z",
    created_at: "2026-07-26T18:00:00.000Z",
    ...overrides,
  };
}

describe("daily-profit-summary-builder (DEV-115)", () => {
  it("builds a zero summary for an empty shift", () => {
    const result = buildDailyProfitSummary({
      shift_id: SHIFT_ID,
      sale_profits: [],
    });

    expect(result.error).toBeNull();
    expect(result.data).toEqual({
      shift_id: SHIFT_ID,
      net_revenue: 0,
      total_cogs: 0,
      gross_profit: 0,
      gross_margin_percent: null,
      is_frozen: true,
    });
  });

  it("handles zero revenue with zero COGS (null margin)", () => {
    const result = buildDailyProfitSummary({
      shift_id: SHIFT_ID,
      sale_profits: [
        {
          sale_id: SALE_A,
          net_revenue: 0,
          cogs: 0,
        },
      ],
    });

    expect(result.error).toBeNull();
    expect(result.data?.net_revenue).toBe(0);
    expect(result.data?.total_cogs).toBe(0);
    expect(result.data?.gross_profit).toBe(0);
    expect(result.data?.gross_margin_percent).toBeNull();
  });

  it("builds a profitable shift summary", () => {
    const result = buildDailyProfitSummary({
      shift_id: SHIFT_ID,
      sale_profits: [
        {
          sale_id: SALE_A,
          net_revenue: 100,
          cogs: 40,
        },
        {
          sale_id: SALE_B,
          net_revenue: 50,
          cogs: 20,
        },
      ],
    });

    expect(result.error).toBeNull();
    expect(result.data).toEqual({
      shift_id: SHIFT_ID,
      net_revenue: 150,
      total_cogs: 60,
      gross_profit: 90,
      gross_margin_percent: 60,
      is_frozen: true,
    });
  });

  it("supports negative profit when COGS exceeds revenue", () => {
    const result = buildDailyProfitSummary({
      shift_id: SHIFT_ID,
      sale_profits: [
        {
          sale_id: SALE_A,
          net_revenue: 50,
          cogs: 80,
        },
      ],
    });

    expect(result.error).toBeNull();
    expect(result.data).toEqual({
      shift_id: SHIFT_ID,
      net_revenue: 50,
      total_cogs: 80,
      gross_profit: -30,
      gross_margin_percent: -60,
      is_frozen: true,
    });
  });

  it("sums raw per-sale COGS and rounds once (not per sale)", () => {
    const result = buildDailyProfitSummary({
      shift_id: SHIFT_ID,
      sale_profits: [
        {
          sale_id: SALE_A,
          net_revenue: 10,
          cogs: 1.004,
        },
        {
          sale_id: SALE_B,
          net_revenue: 10,
          cogs: 1.004,
        },
      ],
    });

    expect(result.error).toBeNull();
    // roundMoney(1.004) + roundMoney(1.004) === 2.00; sql/092 is 2.01.
    expect(result.data?.total_cogs).toBe(2.01);
    expect(result.data?.net_revenue).toBe(20);
    expect(result.data?.gross_profit).toBe(17.99);
  });

  it("rejects duplicate summary generation", () => {
    const result = buildDailyProfitSummary({
      shift_id: SHIFT_ID,
      sale_profits: [],
      existing_shift_ids: [SHIFT_ID],
    });

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "This shift already has a daily profit summary.",
    );
  });

  it("rejects generating for an active shift", () => {
    expect(
      assertCanGenerateDailyProfitSummary(
        closedShift({ status: "open", closed_at: null }),
      ),
    ).toBe("Close the shift before generating the daily profit summary.");
    expect(assertCanGenerateDailyProfitSummary(closedShift())).toBeNull();
  });

  it("guards historical immutability", () => {
    expect(assertDailyProfitSummaryNotDuplicate(summary())).toBe(
      "This shift already has a daily profit summary.",
    );
    expect(assertDailyProfitSummaryNotDuplicate(null)).toBeNull();

    const previous = summary();
    expect(
      assertDailyProfitSummaryHistoricallyImmutable({
        previous,
        next: { ...previous },
      }),
    ).toBeNull();

    expect(
      assertDailyProfitSummaryHistoricallyImmutable({
        previous,
        next: summary({ gross_profit: 1 }),
      }),
    ).toBe("Daily profit summaries are immutable historical records.");
  });
});
