/**
 * Service-level coverage for dailyProfitSummaryService (DEV-115).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  supabaseMock,
  getSaleProfitSummaryMock,
  getSaleCostSummaryMock,
} = vi.hoisted(() => {
  const supabaseMock = {
    from: vi.fn(),
    rpc: vi.fn(),
    auth: {
      getUser: vi.fn(),
    },
  };
  const getSaleProfitSummaryMock = vi.fn();
  const getSaleCostSummaryMock = vi.fn();
  return { supabaseMock, getSaleProfitSummaryMock, getSaleCostSummaryMock };
});

vi.mock("@/lib/supabase", () => ({
  supabase: supabaseMock,
}));

vi.mock("@/features/sales/services/sale-profit-service", () => ({
  saleProfitService: {
    getSaleProfitSummary: getSaleProfitSummaryMock,
  },
}));

vi.mock("@/features/sales/services/sale-cogs-service", () => ({
  saleCogsService: {
    getSaleCostSummary: getSaleCostSummaryMock,
  },
}));

import { dailyProfitSummaryService } from "./daily-profit-summary-service";
import type { DailyProfitSummary } from "../types/daily-profit-summary";
import type { Shift } from "../types/shift";

const SHIFT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SALE_A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SALE_B = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SUMMARY_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const SUMMARY_SELECT =
  "id, shift_id, net_revenue, total_cogs, gross_profit, gross_margin_percent, generated_at, created_at";

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

function mockSalesQuery(rows: Record<string, unknown>[]) {
  const lte = vi.fn().mockResolvedValue({ data: rows, error: null });
  const gte = vi.fn().mockReturnValue({ lte });
  const not = vi.fn().mockReturnValue({ gte });
  const statusIn = vi.fn().mockReturnValue({ not });
  const select = vi.fn().mockReturnValue({ in: statusIn });
  return { select, statusIn, not, gte, lte };
}

function cogsSummary(saleId: string, rawLayerCosts: readonly number[]) {
  return {
    sale_id: saleId,
    total_cogs: rawLayerCosts.reduce((sum, cost) => sum + cost, 0),
    consumed_quantity: rawLayerCosts.length,
    layers: rawLayerCosts.map((total_cost, index) => ({
      consumption_id: `${saleId}-layer-${index}`,
      sale_line_id: `${saleId}-line`,
      production_batch_id: null,
      batch_number: null,
      quantity: 1,
      unit_cost: total_cost,
      total_cost,
      produced_at: null,
      source: "ingredient" as const,
      ingredient_id: null,
      ingredient_name: null,
    })),
    line_summaries: [],
    is_frozen: true as const,
  };
}

describe("dailyProfitSummaryService (DEV-115)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSaleProfitSummaryMock.mockReset();
    getSaleCostSummaryMock.mockReset();
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
          expect(table).toBe("shift_daily_profit_summaries");
          return { select: existing.select };
        }
        if (call === 2) {
          expect(table).toBe("sales");
          return { select: sales.select };
        }
        expect(table).toBe("shift_daily_profit_summaries");
        return { insert };
      });

      const result = await dailyProfitSummaryService.generateForClosedShift(
        closedShift(),
      );

      expect(result.error).toBeNull();
      expect(result.data).toEqual({ summary: mappedSummary() });
      expect(getSaleProfitSummaryMock).not.toHaveBeenCalled();
      expect(getSaleCostSummaryMock).not.toHaveBeenCalled();
      expect(insert).toHaveBeenCalledWith(
        expect.objectContaining({
          shift_id: SHIFT_ID,
          net_revenue: 0,
          total_cogs: 0,
          gross_profit: 0,
          gross_margin_percent: null,
        }),
      );
    });

    it("aggregates frozen sale profits into a profitable summary", async () => {
      const existing = mockExistingSummary(null);
      const sales = mockSalesQuery([
        {
          id: SALE_A,
          status: "confirmed",
          confirmed_at: "2026-07-26T10:00:00.000Z",
          subtotal: 100,
        },
        {
          id: SALE_B,
          status: "paid",
          confirmed_at: "2026-07-26T12:00:00.000Z",
          subtotal: 50,
        },
      ]);
      getSaleProfitSummaryMock
        .mockResolvedValueOnce({
          data: {
            sale_id: SALE_A,
            net_revenue: 100,
            cogs: 40,
            gross_profit: 60,
            gross_margin_percent: 60,
            is_frozen: true,
          },
          error: null,
        })
        .mockResolvedValueOnce({
          data: {
            sale_id: SALE_B,
            net_revenue: 50,
            cogs: 20,
            gross_profit: 30,
            gross_margin_percent: 60,
            is_frozen: true,
          },
          error: null,
        });
      getSaleCostSummaryMock
        .mockResolvedValueOnce({
          data: cogsSummary(SALE_A, [40]),
          error: null,
        })
        .mockResolvedValueOnce({
          data: cogsSummary(SALE_B, [20]),
          error: null,
        });

      const inserted = summaryRow({
        net_revenue: 150,
        total_cogs: 60,
        gross_profit: 90,
        gross_margin_percent: 60,
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
          expect(table).toBe("shift_daily_profit_summaries");
          return { select: existing.select };
        }
        if (call === 2) {
          expect(table).toBe("sales");
          return { select: sales.select };
        }
        expect(table).toBe("shift_daily_profit_summaries");
        return { insert };
      });

      const result = await dailyProfitSummaryService.generateForClosedShift(
        closedShift(),
      );

      expect(result.error).toBeNull();
      expect(result.data?.summary).toEqual(
        mappedSummary({
          net_revenue: 150,
          total_cogs: 60,
          gross_profit: 90,
          gross_margin_percent: 60,
        }),
      );
      expect(getSaleProfitSummaryMock).toHaveBeenCalledTimes(2);
      expect(getSaleProfitSummaryMock).toHaveBeenNthCalledWith(1, SALE_A);
      expect(getSaleProfitSummaryMock).toHaveBeenNthCalledWith(2, SALE_B);
      expect(getSaleCostSummaryMock).toHaveBeenCalledTimes(2);
    });

    it("sums raw layer COGS and rounds once, ignoring per-sale rounded COGS", async () => {
      const existing = mockExistingSummary(null);
      const sales = mockSalesQuery([
        {
          id: SALE_A,
          status: "confirmed",
          confirmed_at: "2026-07-26T10:00:00.000Z",
          subtotal: 10,
        },
        {
          id: SALE_B,
          status: "paid",
          confirmed_at: "2026-07-26T12:00:00.000Z",
          subtotal: 10,
        },
      ]);
      getSaleProfitSummaryMock
        .mockResolvedValueOnce({
          data: {
            sale_id: SALE_A,
            net_revenue: 10,
            cogs: 1,
            gross_profit: 9,
            gross_margin_percent: 90,
            is_frozen: true,
          },
          error: null,
        })
        .mockResolvedValueOnce({
          data: {
            sale_id: SALE_B,
            net_revenue: 10,
            cogs: 1,
            gross_profit: 9,
            gross_margin_percent: 90,
            is_frozen: true,
          },
          error: null,
        });
      getSaleCostSummaryMock
        .mockResolvedValueOnce({
          data: cogsSummary(SALE_A, [1.004]),
          error: null,
        })
        .mockResolvedValueOnce({
          data: cogsSummary(SALE_B, [1.004]),
          error: null,
        });

      const inserted = summaryRow({
        net_revenue: 20,
        total_cogs: 2.01,
        gross_profit: 17.99,
        gross_margin_percent: 89.95,
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
          expect(table).toBe("shift_daily_profit_summaries");
          return { select: existing.select };
        }
        if (call === 2) {
          expect(table).toBe("sales");
          return { select: sales.select };
        }
        expect(table).toBe("shift_daily_profit_summaries");
        return { insert };
      });

      const result = await dailyProfitSummaryService.generateForClosedShift(
        closedShift(),
      );

      expect(result.error).toBeNull();
      expect(insert).toHaveBeenCalledWith(
        expect.objectContaining({
          shift_id: SHIFT_ID,
          net_revenue: 20,
          total_cogs: 2.01,
          gross_profit: 17.99,
          gross_margin_percent: 89.95,
        }),
      );
      expect(result.data?.summary.total_cogs).toBe(2.01);
    });

    it("supports negative profit from frozen sale profits", async () => {
      const existing = mockExistingSummary(null);
      const sales = mockSalesQuery([
        {
          id: SALE_A,
          status: "confirmed",
          confirmed_at: "2026-07-26T10:00:00.000Z",
          subtotal: 40,
        },
      ]);
      getSaleProfitSummaryMock.mockResolvedValue({
        data: {
          sale_id: SALE_A,
          net_revenue: 40,
          cogs: 70,
          gross_profit: -30,
          gross_margin_percent: -75,
          is_frozen: true,
        },
        error: null,
      });
      getSaleCostSummaryMock.mockResolvedValue({
        data: cogsSummary(SALE_A, [70]),
        error: null,
      });

      const inserted = summaryRow({
        net_revenue: 40,
        total_cogs: 70,
        gross_profit: -30,
        gross_margin_percent: -75,
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
        return { insert };
      });

      const result = await dailyProfitSummaryService.generateForClosedShift(
        closedShift(),
      );

      expect(result.error).toBeNull();
      expect(result.data?.summary.gross_profit).toBe(-30);
      expect(result.data?.summary.gross_margin_percent).toBe(-75);
    });

    it("rejects duplicate summary generation", async () => {
      const existing = mockExistingSummary(
        summaryRow({
          net_revenue: 100,
          total_cogs: 40,
          gross_profit: 60,
          gross_margin_percent: 60,
        }),
      );
      supabaseMock.from.mockImplementation((table: string) => {
        expect(table).toBe("shift_daily_profit_summaries");
        return { select: existing.select };
      });

      const result = await dailyProfitSummaryService.generateForClosedShift(
        closedShift(),
      );

      expect(result.data).toBeNull();
      expect(result.error).toBe(
        "This shift already has a daily profit summary.",
      );
      expect(getSaleProfitSummaryMock).not.toHaveBeenCalled();
      expect(getSaleCostSummaryMock).not.toHaveBeenCalled();
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
                'duplicate key value violates unique constraint "shift_daily_profit_summaries_shift_uidx"',
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

      const result = await dailyProfitSummaryService.generateForClosedShift(
        closedShift(),
      );

      expect(result.data).toBeNull();
      expect(result.error).toBe(
        "This shift already has a daily profit summary.",
      );
    });

    it("preserves immutable historical amounts after insert", async () => {
      const existing = mockExistingSummary(null);
      const sales = mockSalesQuery([
        {
          id: SALE_A,
          status: "confirmed",
          confirmed_at: "2026-07-26T11:00:00.000Z",
          subtotal: 80,
        },
      ]);
      getSaleProfitSummaryMock.mockResolvedValue({
        data: {
          sale_id: SALE_A,
          net_revenue: 80,
          cogs: 32,
          gross_profit: 48,
          gross_margin_percent: 60,
          is_frozen: true,
        },
        error: null,
      });
      getSaleCostSummaryMock.mockResolvedValue({
        data: cogsSummary(SALE_A, [32]),
        error: null,
      });
      const inserted = summaryRow({
        net_revenue: 80,
        total_cogs: 32,
        gross_profit: 48,
        gross_margin_percent: 60,
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
        return { insert };
      });

      const result = await dailyProfitSummaryService.generateForClosedShift(
        closedShift(),
      );

      expect(result.error).toBeNull();
      expect(
        dailyProfitSummaryService.assertDailyProfitSummaryHistoricallyImmutable(
          {
            previous: result.data!.summary,
            next: result.data!.summary,
          },
        ),
      ).toBeNull();
    });
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
      expect(getSaleProfitSummaryMock).not.toHaveBeenCalled();
    });
  });
});
