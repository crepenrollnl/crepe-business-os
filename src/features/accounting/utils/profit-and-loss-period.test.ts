/**
 * Period-bound and reconciliation helpers for get_profit_and_loss.
 * Local calendar dates only — no UTC date_trunc, no mocks.
 */

import { describe, expect, it } from "vitest";
import type { ProfitAndLossReport } from "../types/profit-and-loss";
import {
  hasReconciliationMismatch,
  monthBounds,
  resolveCustomPeriod,
} from "./profit-and-loss-period";

function matchedLine(mismatch: boolean) {
  return {
    operational_amount: mismatch ? 100 : 80,
    ledger_amount: 80,
    mismatch,
  };
}

function report(
  overrides?: Partial<ProfitAndLossReport>,
): ProfitAndLossReport {
  return {
    period_start: "2026-09-01",
    period_end: "2026-09-30",
    revenue: 80,
    cogs: 20,
    gross_profit: 60,
    opex_breakdown: [],
    opex: 0,
    write_offs: 0,
    depreciation: 0,
    net_profit: 60,
    reconciliation: {
      sales_revenue: matchedLine(false),
      cogs: matchedLine(false),
      write_offs: matchedLine(false),
    },
    ...overrides,
  };
}

describe("monthBounds", () => {
  it("returns the first and last local calendar days of September", () => {
    expect(monthBounds(2026, 8)).toEqual({
      start: "2026-09-01",
      end: "2026-09-30",
    });
  });

  it("returns 31 days for December and January across a year boundary", () => {
    expect(monthBounds(2026, 11)).toEqual({
      start: "2026-12-01",
      end: "2026-12-31",
    });
    expect(monthBounds(2027, 0)).toEqual({
      start: "2027-01-01",
      end: "2027-01-31",
    });
  });

  it("returns 29 February in a leap year and 28 February otherwise", () => {
    expect(monthBounds(2024, 1)).toEqual({
      start: "2024-02-01",
      end: "2024-02-29",
    });
    expect(monthBounds(2025, 1)).toEqual({
      start: "2025-02-01",
      end: "2025-02-28",
    });
  });

  it("returns 30 days for April", () => {
    expect(monthBounds(2026, 3)).toEqual({
      start: "2026-04-01",
      end: "2026-04-30",
    });
  });
});

describe("resolveCustomPeriod", () => {
  it("returns the inclusive start and end of a valid range", () => {
    expect(resolveCustomPeriod("2026-09-01", "2026-09-15")).toEqual({
      start: "2026-09-01",
      end: "2026-09-15",
    });
  });

  it("accepts a single-day range", () => {
    expect(resolveCustomPeriod("2026-09-21", "2026-09-21")).toEqual({
      start: "2026-09-21",
      end: "2026-09-21",
    });
  });

  it("returns an error when from is after to", () => {
    expect(resolveCustomPeriod("2026-09-15", "2026-09-01")).toEqual({
      error: "Start date must be on or before end date.",
    });
  });

  it("returns an error for an invalid date string", () => {
    expect(resolveCustomPeriod("not-a-date", "2026-09-01")).toEqual({
      error: "Enter a valid start and end date.",
    });
    expect(resolveCustomPeriod("2026-09-01", "")).toEqual({
      error: "Enter a valid start and end date.",
    });
    expect(resolveCustomPeriod("2026-9-1", "2026-09-02")).toEqual({
      error: "Enter a valid start and end date.",
    });
  });
});

describe("hasReconciliationMismatch", () => {
  it("is false when every mismatch flag is false", () => {
    expect(hasReconciliationMismatch(report())).toBe(false);
  });

  it("is true when only sales_revenue.mismatch is true", () => {
    expect(
      hasReconciliationMismatch(
        report({
          reconciliation: {
            sales_revenue: matchedLine(true),
            cogs: matchedLine(false),
            write_offs: matchedLine(false),
          },
        }),
      ),
    ).toBe(true);
  });

  it("is true when only cogs.mismatch is true", () => {
    expect(
      hasReconciliationMismatch(
        report({
          reconciliation: {
            sales_revenue: matchedLine(false),
            cogs: matchedLine(true),
            write_offs: matchedLine(false),
          },
        }),
      ),
    ).toBe(true);
  });

  it("is true when only write_offs.mismatch is true", () => {
    expect(
      hasReconciliationMismatch(
        report({
          reconciliation: {
            sales_revenue: matchedLine(false),
            cogs: matchedLine(false),
            write_offs: matchedLine(true),
          },
        }),
      ),
    ).toBe(true);
  });
});
