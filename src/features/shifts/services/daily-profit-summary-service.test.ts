/**
 * Service-level coverage for dailyProfitSummaryService (DEV-115).
 *
 * The summary is written by close_shift (sql/142); this service only reads it.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { supabaseMock } = vi.hoisted(() => {
  const supabaseMock = {
    from: vi.fn(),
    rpc: vi.fn(),
  };
  return { supabaseMock };
});

vi.mock("@/lib/supabase", () => ({
  supabase: supabaseMock,
}));

import { dailyProfitSummaryService } from "./daily-profit-summary-service";
import type { DailyProfitSummary } from "../types/daily-profit-summary";

const SHIFT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SUMMARY_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const SUMMARY_SELECT =
  "id, shift_id, net_revenue, total_cogs, gross_profit, gross_margin_percent, generated_at, created_at";

function summaryRow(overrides?: Record<string, unknown>) {
  return {
    id: SUMMARY_ID,
    shift_id: SHIFT_ID,
    net_revenue: 0,
    total_cogs: 0,
    gross_profit: 0,
    gross_margin_percent: null,
    generated_at: "2026-07-26T18:00:01.000Z",
    created_at: "2026-07-26T18:00:01.000Z",
    ...overrides,
  };
}

function mappedSummary(
  overrides?: Partial<DailyProfitSummary>,
): DailyProfitSummary {
  return {
    id: SUMMARY_ID,
    shift_id: SHIFT_ID,
    net_revenue: 0,
    total_cogs: 0,
    gross_profit: 0,
    gross_margin_percent: null,
    generated_at: "2026-07-26T18:00:01.000Z",
    created_at: "2026-07-26T18:00:01.000Z",
    ...overrides,
  };
}

function mockExistingSummary(row: Record<string, unknown> | null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null });
  const eq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });
  return { select, eq, maybeSingle };
}

describe("dailyProfitSummaryService (DEV-115)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getSummaryForShift", () => {
    it("loads an existing immutable summary without recalculating", async () => {
      const existing = mockExistingSummary(
        summaryRow({
          net_revenue: 200,
          total_cogs: 80,
          gross_profit: 120,
          gross_margin_percent: 60,
        }),
      );
      supabaseMock.from.mockImplementation((table: string) => {
        expect(table).toBe("shift_daily_profit_summaries");
        return { select: existing.select };
      });

      const result =
        await dailyProfitSummaryService.getSummaryForShift(SHIFT_ID);

      expect(result.error).toBeNull();
      expect(result.data).toEqual(
        mappedSummary({
          net_revenue: 200,
          total_cogs: 80,
          gross_profit: 120,
          gross_margin_percent: 60,
        }),
      );
      expect(existing.select).toHaveBeenCalledWith(SUMMARY_SELECT);
      expect(supabaseMock.rpc).not.toHaveBeenCalled();
    });
  });
});
