/**
 * Service-level coverage for dailySalesSummaryService (DEV-114).
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

import { dailySalesSummaryService } from "./daily-sales-summary-service";
import type { DailySalesSummary } from "../types/daily-sales-summary";

const SHIFT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SUMMARY_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const SUMMARY_SELECT =
  "id, shift_id, sales_count, items_sold, gross_revenue, net_revenue, average_receipt, generated_at, created_at";

function summaryRow(overrides?: Record<string, unknown>) {
  return {
    id: SUMMARY_ID,
    shift_id: SHIFT_ID,
    sales_count: 0,
    items_sold: 0,
    gross_revenue: 0,
    net_revenue: 0,
    average_receipt: 0,
    generated_at: "2026-07-26T18:00:01.000Z",
    created_at: "2026-07-26T18:00:01.000Z",
    ...overrides,
  };
}

function mappedSummary(
  overrides?: Partial<DailySalesSummary>,
): DailySalesSummary {
  return {
    id: SUMMARY_ID,
    shift_id: SHIFT_ID,
    sales_count: 0,
    items_sold: 0,
    gross_revenue: 0,
    net_revenue: 0,
    average_receipt: 0,
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

describe("dailySalesSummaryService (DEV-114)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getSummaryForShift", () => {
    it("loads an existing immutable summary without recalculating", async () => {
      const existing = mockExistingSummary(
        summaryRow({
          sales_count: 3,
          items_sold: 9,
          gross_revenue: 300,
          net_revenue: 250,
          average_receipt: 100,
        }),
      );
      supabaseMock.from.mockImplementation((table: string) => {
        expect(table).toBe("shift_daily_sales_summaries");
        return { select: existing.select };
      });

      const result =
        await dailySalesSummaryService.getSummaryForShift(SHIFT_ID);

      expect(result.error).toBeNull();
      expect(result.data).toEqual(
        mappedSummary({
          sales_count: 3,
          items_sold: 9,
          gross_revenue: 300,
          net_revenue: 250,
          average_receipt: 100,
        }),
      );
      expect(existing.select).toHaveBeenCalledWith(SUMMARY_SELECT);
      expect(supabaseMock.rpc).not.toHaveBeenCalled();
    });
  });
});
