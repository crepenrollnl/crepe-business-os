/**
 * Pure builder coverage for Daily Sales Summary (DEV-114).
 */

import { describe, expect, it } from "vitest";
import type { DailySalesSummary } from "../types/daily-sales-summary";
import type { Shift } from "../types/shift";
import {
  assertCanGenerateDailySalesSummary,
  assertDailySalesSummaryHistoricallyImmutable,
  assertDailySalesSummaryNotDuplicate,
  buildDailySalesSummary,
} from "./daily-sales-summary-builder";

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

function summary(overrides?: Partial<DailySalesSummary>): DailySalesSummary {
  return {
    id: SUMMARY_ID,
    shift_id: SHIFT_ID,
    sales_count: 2,
    items_sold: 5,
    gross_revenue: 121,
    net_revenue: 100,
    average_receipt: 60.5,
    generated_at: "2026-07-26T18:00:00.000Z",
    created_at: "2026-07-26T18:00:00.000Z",
    ...overrides,
  };
}

describe("daily-sales-summary-builder (DEV-114)", () => {
  it("builds a zero summary for an empty shift / no completed sales", () => {
    const result = buildDailySalesSummary({
      shift_id: SHIFT_ID,
      sales: [],
    });

    expect(result.error).toBeNull();
    expect(result.data).toEqual({
      shift_id: SHIFT_ID,
      sales_count: 0,
      items_sold: 0,
      gross_revenue: 0,
      net_revenue: 0,
      average_receipt: 0,
      is_frozen: true,
    });
  });

  it("builds a normal shift summary from one completed sale", () => {
    const result = buildDailySalesSummary({
      shift_id: SHIFT_ID,
      sales: [
        {
          id: SALE_A,
          status: "confirmed",
          subtotal: 100,
          total: 121,
          items_sold: 3,
        },
      ],
    });

    expect(result.error).toBeNull();
    expect(result.data).toEqual({
      shift_id: SHIFT_ID,
      sales_count: 1,
      items_sold: 3,
      gross_revenue: 121,
      net_revenue: 100,
      average_receipt: 121,
      is_frozen: true,
    });
  });

  it("aggregates multiple completed sales", () => {
    const result = buildDailySalesSummary({
      shift_id: SHIFT_ID,
      sales: [
        {
          id: SALE_A,
          status: "confirmed",
          subtotal: 100,
          total: 121,
          items_sold: 2,
        },
        {
          id: SALE_B,
          status: "paid",
          subtotal: 50,
          total: 60.5,
          items_sold: 4,
        },
      ],
    });

    expect(result.error).toBeNull();
    expect(result.data).toEqual({
      shift_id: SHIFT_ID,
      sales_count: 2,
      items_sold: 6,
      gross_revenue: 181.5,
      net_revenue: 150,
      average_receipt: 90.75,
      is_frozen: true,
    });
  });

  it("rejects duplicate summary generation", () => {
    const result = buildDailySalesSummary({
      shift_id: SHIFT_ID,
      sales: [],
      existing_shift_ids: [SHIFT_ID],
    });

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "This shift already has a daily sales summary.",
    );
  });

  it("rejects generating for an active shift", () => {
    expect(
      assertCanGenerateDailySalesSummary(
        closedShift({ status: "open", closed_at: null }),
      ),
    ).toBe("Close the shift before generating the daily sales summary.");
    expect(assertCanGenerateDailySalesSummary(closedShift())).toBeNull();
  });

  it("guards already-existing summaries and historical immutability", () => {
    expect(assertDailySalesSummaryNotDuplicate(summary())).toBe(
      "This shift already has a daily sales summary.",
    );
    expect(assertDailySalesSummaryNotDuplicate(null)).toBeNull();

    const previous = summary();
    expect(
      assertDailySalesSummaryHistoricallyImmutable({
        previous,
        next: { ...previous },
      }),
    ).toBeNull();

    expect(
      assertDailySalesSummaryHistoricallyImmutable({
        previous,
        next: summary({ gross_revenue: 999 }),
      }),
    ).toBe("Daily sales summaries are immutable historical records.");
  });
});
