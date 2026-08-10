/**
 * Service-level coverage for dailySalesSummaryService (DEV-114).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { supabaseMock } = vi.hoisted(() => {
  const supabaseMock = {
    from: vi.fn(),
    rpc: vi.fn(),
    auth: {
      getUser: vi.fn(),
    },
  };
  return { supabaseMock };
});

vi.mock("@/lib/supabase", () => ({
  supabase: supabaseMock,
}));

import { dailySalesSummaryService } from "./daily-sales-summary-service";
import type { DailySalesSummary } from "../types/daily-sales-summary";
import type { Shift } from "../types/shift";

const SHIFT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SALE_A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SALE_B = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SUMMARY_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const SUMMARY_SELECT =
  "id, shift_id, sales_count, items_sold, gross_revenue, net_revenue, average_receipt, generated_at, created_at";

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

function mockSalesQuery(rows: Record<string, unknown>[]) {
  const lte = vi.fn().mockResolvedValue({ data: rows, error: null });
  const gte = vi.fn().mockReturnValue({ lte });
  const not = vi.fn().mockReturnValue({ gte });
  const statusIn = vi.fn().mockReturnValue({ not });
  const select = vi.fn().mockReturnValue({ in: statusIn });
  return { select, statusIn, not, gte, lte };
}

function mockSaleLinesQuery(rows: Record<string, unknown>[]) {
  const saleIdIn = vi.fn().mockResolvedValue({ data: rows, error: null });
  const select = vi.fn().mockReturnValue({ in: saleIdIn });
  return { select, saleIdIn };
}

describe("dailySalesSummaryService (DEV-114)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabaseMock.rpc.mockResolvedValue({ data: true, error: null });
  });

  describe("generateForClosedShift", () => {
    it("stores a zero summary for an empty shift", async () => {
      const existing = mockExistingSummary(null);
      const sales = mockSalesQuery([]);
      const inserted = summaryRow();
      const insert = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: inserted, error: null }),
        }),
      });

      let call = 0;
      supabaseMock.from.mockImplementation((table: string) => {
        call += 1;
        if (call === 1) {
          expect(table).toBe("shift_daily_sales_summaries");
          return { select: existing.select };
        }
        if (call === 2) {
          expect(table).toBe("sales");
          return { select: sales.select };
        }
        expect(table).toBe("shift_daily_sales_summaries");
        return { insert };
      });

      const result = await dailySalesSummaryService.generateForClosedShift(
        closedShift(),
      );

      expect(result.error).toBeNull();
      expect(result.data).toEqual({ summary: mappedSummary() });
      expect(insert).toHaveBeenCalledWith(
        expect.objectContaining({
          shift_id: SHIFT_ID,
          sales_count: 0,
          items_sold: 0,
          gross_revenue: 0,
          net_revenue: 0,
          average_receipt: 0,
        }),
      );
    });

    it("aggregates multiple completed sales into a frozen summary", async () => {
      const existing = mockExistingSummary(null);
      const sales = mockSalesQuery([
        {
          id: SALE_A,
          status: "confirmed",
          subtotal: 100,
          total: 121,
          confirmed_at: "2026-07-26T10:00:00.000Z",
        },
        {
          id: SALE_B,
          status: "paid",
          subtotal: 50,
          total: 60.5,
          confirmed_at: "2026-07-26T12:00:00.000Z",
        },
      ]);
      const lines = mockSaleLinesQuery([
        { sale_id: SALE_A, quantity: 2 },
        { sale_id: SALE_A, quantity: 1 },
        { sale_id: SALE_B, quantity: 4 },
      ]);
      const inserted = summaryRow({
        sales_count: 2,
        items_sold: 7,
        gross_revenue: 181.5,
        net_revenue: 150,
        average_receipt: 90.75,
      });
      const insert = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: inserted, error: null }),
        }),
      });

      let call = 0;
      supabaseMock.from.mockImplementation((table: string) => {
        call += 1;
        if (call === 1) {
          expect(table).toBe("shift_daily_sales_summaries");
          return { select: existing.select };
        }
        if (call === 2) {
          expect(table).toBe("sales");
          return { select: sales.select };
        }
        if (call === 3) {
          expect(table).toBe("sale_lines");
          return { select: lines.select };
        }
        expect(table).toBe("shift_daily_sales_summaries");
        return { insert };
      });

      const result = await dailySalesSummaryService.generateForClosedShift(
        closedShift(),
      );

      expect(result.error).toBeNull();
      expect(result.data?.summary).toEqual(
        mappedSummary({
          sales_count: 2,
          items_sold: 7,
          gross_revenue: 181.5,
          net_revenue: 150,
          average_receipt: 90.75,
        }),
      );
      expect(insert).toHaveBeenCalledWith(
        expect.objectContaining({
          sales_count: 2,
          items_sold: 7,
          gross_revenue: 181.5,
          net_revenue: 150,
          average_receipt: 90.75,
        }),
      );
      expect(sales.select).toHaveBeenCalled();
    });

    it("rejects duplicate summary generation", async () => {
      const existing = mockExistingSummary(summaryRow({ sales_count: 1 }));
      supabaseMock.from.mockImplementation((table: string) => {
        expect(table).toBe("shift_daily_sales_summaries");
        return { select: existing.select };
      });

      const result = await dailySalesSummaryService.generateForClosedShift(
        closedShift(),
      );

      expect(result.data).toBeNull();
      expect(result.error).toBe(
        "This shift already has a daily sales summary.",
      );
    });

    it("maps unique-constraint duplicate errors", async () => {
      const existing = mockExistingSummary(null);
      const sales = mockSalesQuery([]);
      const insert = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: null,
            error: {
              message:
                'duplicate key value violates unique constraint "shift_daily_sales_summaries_shift_uidx"',
            },
          }),
        }),
      });

      let call = 0;
      supabaseMock.from.mockImplementation(() => {
        call += 1;
        if (call === 1) {
          return { select: existing.select };
        }
        if (call === 2) {
          return { select: sales.select };
        }
        return { insert };
      });

      const result = await dailySalesSummaryService.generateForClosedShift(
        closedShift(),
      );

      expect(result.data).toBeNull();
      expect(result.error).toBe(
        "This shift already has a daily sales summary.",
      );
    });

    it("rejects generation for an active shift", async () => {
      const result = await dailySalesSummaryService.generateForClosedShift(
        closedShift({ status: "open", closed_at: null }),
      );

      expect(result.data).toBeNull();
      expect(result.error).toBe(
        "Close the shift before generating the daily sales summary.",
      );
      expect(supabaseMock.from).not.toHaveBeenCalled();
    });

    it("preserves immutable historical amounts after insert", async () => {
      const existing = mockExistingSummary(null);
      const sales = mockSalesQuery([
        {
          id: SALE_A,
          status: "confirmed",
          subtotal: 80,
          total: 96.8,
          confirmed_at: "2026-07-26T11:00:00.000Z",
        },
      ]);
      const lines = mockSaleLinesQuery([{ sale_id: SALE_A, quantity: 2 }]);
      const inserted = summaryRow({
        sales_count: 1,
        items_sold: 2,
        gross_revenue: 96.8,
        net_revenue: 80,
        average_receipt: 96.8,
      });
      const insert = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: inserted, error: null }),
        }),
      });

      let call = 0;
      supabaseMock.from.mockImplementation(() => {
        call += 1;
        if (call === 1) {
          return { select: existing.select };
        }
        if (call === 2) {
          return { select: sales.select };
        }
        if (call === 3) {
          return { select: lines.select };
        }
        return { insert };
      });

      const result = await dailySalesSummaryService.generateForClosedShift(
        closedShift(),
      );

      expect(result.error).toBeNull();
      expect(
        dailySalesSummaryService.assertDailySalesSummaryHistoricallyImmutable({
          previous: result.data!.summary,
          next: result.data!.summary,
        }),
      ).toBeNull();
      expect(insert.mock.calls[0]?.[0]).toEqual(
        expect.objectContaining({
          gross_revenue: 96.8,
          net_revenue: 80,
        }),
      );
    });
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
    });
  });
});
