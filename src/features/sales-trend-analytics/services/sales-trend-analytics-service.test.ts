/**
 * Service-level coverage for salesTrendAnalyticsService (DEV-063).
 *
 * Reads must go only through get_sales_trends / get_sales_trend_summary RPCs.
 * The service must not query tables directly, recalculate metrics, cache,
 * or write data.
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

import { salesTrendAnalyticsService } from "./sales-trend-analytics-service";
import type {
  SalesTrendAnalytics,
  SalesTrendSummary,
} from "../types/sales-trend-analytics";

const insertMock = vi.fn();
const updateMock = vi.fn();
const deleteMock = vi.fn();

function trendRow(overrides?: Record<string, unknown>) {
  return {
    period_start: "2026-07-25T00:00:00.000Z",
    period_type: "daily",
    sale_count: 4,
    total_revenue: "400.00",
    average_sale_value: "100.00",
    ...overrides,
  };
}

function mappedTrend(
  overrides?: Partial<SalesTrendAnalytics>,
): SalesTrendAnalytics {
  return {
    period_start: "2026-07-25T00:00:00.000Z",
    period_type: "daily",
    sale_count: 4,
    total_revenue: 400,
    average_sale_value: 100,
    ...overrides,
  };
}

function summaryRow(overrides?: Record<string, unknown>) {
  return {
    sale_count: 10,
    total_revenue: "1250.00",
    average_sale_value: "125.00",
    first_sale_at: "2026-07-01T10:00:00.000Z",
    last_sale_at: "2026-07-25T16:00:00.000Z",
    ...overrides,
  };
}

function mappedSummary(
  overrides?: Partial<SalesTrendSummary>,
): SalesTrendSummary {
  return {
    sale_count: 10,
    total_revenue: 1250,
    average_sale_value: 125,
    first_sale_at: "2026-07-01T10:00:00.000Z",
    last_sale_at: "2026-07-25T16:00:00.000Z",
    ...overrides,
  };
}

function expectNoDirectWrites() {
  expect(supabaseMock.from).not.toHaveBeenCalled();
  expect(insertMock).not.toHaveBeenCalled();
  expect(updateMock).not.toHaveBeenCalled();
  expect(deleteMock).not.toHaveBeenCalled();
}

function expectReadOnly(rpcName: string) {
  expect(supabaseMock.rpc.mock.calls.map((call) => call[0])).toEqual([
    rpcName,
  ]);
  expect(supabaseMock.auth.getUser).not.toHaveBeenCalled();
  expectNoDirectWrites();
}

describe("salesTrendAnalyticsService.getSalesTrends (DEV-063)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertMock.mockReset();
    updateMock.mockReset();
    deleteMock.mockReset();
    supabaseMock.from.mockImplementation(() => ({
      select: vi.fn(),
      insert: insertMock,
      update: updateMock,
      delete: deleteMock,
    }));
  });

  it("retrieves daily trends successfully via get_sales_trends", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [
        trendRow({
          period_start: "2026-07-26T00:00:00.000Z",
          sale_count: 2,
          total_revenue: "80.00",
          average_sale_value: "40.00",
        }),
        trendRow(),
      ],
      error: null,
    });

    const result = await salesTrendAnalyticsService.getSalesTrends("daily");

    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(2);
    expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
    expect(supabaseMock.rpc).toHaveBeenCalledWith("get_sales_trends", {
      p_period_type: "daily",
    });
    expectReadOnly("get_sales_trends");
  });

  it("retrieves weekly trends successfully via get_sales_trends", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [
        trendRow({
          period_start: "2026-07-20T00:00:00.000Z",
          period_type: "weekly",
          sale_count: 8,
          total_revenue: "960.00",
          average_sale_value: "120.00",
        }),
      ],
      error: null,
    });

    const result = await salesTrendAnalyticsService.getSalesTrends("weekly");

    expect(result.error).toBeNull();
    expect(result.data).toEqual([
      mappedTrend({
        period_start: "2026-07-20T00:00:00.000Z",
        period_type: "weekly",
        sale_count: 8,
        total_revenue: 960,
        average_sale_value: 120,
      }),
    ] satisfies SalesTrendAnalytics[]);
    expect(supabaseMock.rpc).toHaveBeenCalledWith("get_sales_trends", {
      p_period_type: "weekly",
    });
    expectReadOnly("get_sales_trends");
  });

  it("retrieves monthly trends successfully via get_sales_trends", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [
        trendRow({
          period_start: "2026-07-01T00:00:00.000Z",
          period_type: "monthly",
          sale_count: 30,
          total_revenue: "4500.00",
          average_sale_value: "150.00",
        }),
      ],
      error: null,
    });

    const result = await salesTrendAnalyticsService.getSalesTrends("MONTHLY");

    expect(result.error).toBeNull();
    expect(result.data?.[0]?.period_type).toBe("monthly");
    expect(supabaseMock.rpc).toHaveBeenCalledWith("get_sales_trends", {
      p_period_type: "monthly",
    });
    expectReadOnly("get_sales_trends");
  });

  it("returns an empty array when trends are empty", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [],
      error: null,
    });

    const result = await salesTrendAnalyticsService.getSalesTrends("daily");

    expect(result.error).toBeNull();
    expect(result.data).toEqual([] satisfies SalesTrendAnalytics[]);
    expectReadOnly("get_sales_trends");
  });

  it("maps RPC rows to typed SalesTrendAnalytics DTOs", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [
        trendRow({
          period_start: "2026-07-24T00:00:00.000Z",
          period_type: "daily",
          sale_count: 3,
          total_revenue: "225.50",
          average_sale_value: "75.17",
        }),
      ],
      error: null,
    });

    const result = await salesTrendAnalyticsService.getSalesTrends("daily");

    expect(result.error).toBeNull();
    expect(result.data).toEqual([
      mappedTrend({
        period_start: "2026-07-24T00:00:00.000Z",
        period_type: "daily",
        sale_count: 3,
        total_revenue: 225.5,
        average_sale_value: 75.17,
      }),
    ] satisfies SalesTrendAnalytics[]);
    expectReadOnly("get_sales_trends");
  });

  it("maps sale_count, total_revenue, and average_sale_value from SQL without recalculation", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [
        trendRow({
          sale_count: 5,
          total_revenue: "999.99",
          average_sale_value: "12.34",
        }),
      ],
      error: null,
    });

    const result = await salesTrendAnalyticsService.getSalesTrends("daily");

    expect(result.error).toBeNull();
    // Values come from the RPC as-is - never recomputed from revenue / count.
    expect(result.data?.[0]?.sale_count).toBe(5);
    expect(result.data?.[0]?.total_revenue).toBe(999.99);
    expect(result.data?.[0]?.average_sale_value).toBe(12.34);
    expectReadOnly("get_sales_trends");
  });

  it("rejects invalid period type without calling the RPC", async () => {
    const blank = await salesTrendAnalyticsService.getSalesTrends("   ");
    expect(blank.data).toBeNull();
    expect(blank.error).toBe(
      "Period type must be daily, weekly, or monthly.",
    );

    const invalid = await salesTrendAnalyticsService.getSalesTrends("yearly");
    expect(invalid.data).toBeNull();
    expect(invalid.error).toBe(
      "Period type must be daily, weekly, or monthly.",
    );

    expect(supabaseMock.rpc).not.toHaveBeenCalled();
    expectNoDirectWrites();
  });

  it("maps missing get_sales_trends function errors", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message: "Could not find the function public.get_sales_trends",
      },
    });

    const result = await salesTrendAnalyticsService.getSalesTrends("daily");

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "Sales trend analytics is not available yet. Apply the sales trend analytics database script and try again.",
    );
    expectNoDirectWrites();
  });

  it("maps period type validation errors from the RPC", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message: "Period type must be daily, weekly, or monthly.",
      },
    });

    const result = await salesTrendAnalyticsService.getSalesTrends("daily");

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "Period type must be daily, weekly, or monthly.",
    );
    expectNoDirectWrites();
  });

  it("rejects invalid trend payloads", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: { not: "an-array" },
      error: null,
    });

    const result = await salesTrendAnalyticsService.getSalesTrends("daily");

    expect(result.data).toBeNull();
    expect(result.error).toBe("Sales trend analytics response was invalid.");
    expectNoDirectWrites();
  });

  it("is read-only and never writes tables", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [trendRow()],
      error: null,
    });

    await salesTrendAnalyticsService.getSalesTrends("daily");

    expectReadOnly("get_sales_trends");
  });

  it("never queries sales trend tables directly", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [trendRow()],
      error: null,
    });

    await salesTrendAnalyticsService.getSalesTrends("daily");

    expect(supabaseMock.from).not.toHaveBeenCalledWith("sales_trend_analytics");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("sales");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("sale_lines");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("report_sales_summary");
    expectNoDirectWrites();
  });
});

describe("salesTrendAnalyticsService.getSalesTrendSummary (DEV-063)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertMock.mockReset();
    updateMock.mockReset();
    deleteMock.mockReset();
    supabaseMock.from.mockImplementation(() => ({
      select: vi.fn(),
      insert: insertMock,
      update: updateMock,
      delete: deleteMock,
    }));
  });

  it("retrieves sales trend summary successfully via get_sales_trend_summary", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: summaryRow(),
      error: null,
    });

    const result = await salesTrendAnalyticsService.getSalesTrendSummary();

    expect(result.error).toBeNull();
    expect(result.data).toEqual(mappedSummary() satisfies SalesTrendSummary);
    expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
    expect(supabaseMock.rpc).toHaveBeenCalledWith("get_sales_trend_summary");
    expectReadOnly("get_sales_trend_summary");
  });

  it("maps summary metrics from SQL without recalculation", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: summaryRow({
        sale_count: 7,
        total_revenue: "777.77",
        average_sale_value: "11.11",
        first_sale_at: null,
        last_sale_at: null,
      }),
      error: null,
    });

    const result = await salesTrendAnalyticsService.getSalesTrendSummary();

    expect(result.error).toBeNull();
    expect(result.data).toEqual(
      mappedSummary({
        sale_count: 7,
        total_revenue: 777.77,
        average_sale_value: 11.11,
        first_sale_at: null,
        last_sale_at: null,
      }) satisfies SalesTrendSummary,
    );
    expectReadOnly("get_sales_trend_summary");
  });

  it("maps empty-sales summary with zero metrics", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: summaryRow({
        sale_count: 0,
        total_revenue: "0.00",
        average_sale_value: "0.00",
        first_sale_at: null,
        last_sale_at: null,
      }),
      error: null,
    });

    const result = await salesTrendAnalyticsService.getSalesTrendSummary();

    expect(result.error).toBeNull();
    expect(result.data?.sale_count).toBe(0);
    expect(result.data?.total_revenue).toBe(0);
    expect(result.data?.average_sale_value).toBe(0);
    expect(result.data?.first_sale_at).toBeNull();
    expect(result.data?.last_sale_at).toBeNull();
    expectReadOnly("get_sales_trend_summary");
  });

  it("maps missing get_sales_trend_summary function errors", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message: "Could not find the function public.get_sales_trend_summary",
      },
    });

    const result = await salesTrendAnalyticsService.getSalesTrendSummary();

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "Sales trend analytics is not available yet. Apply the sales trend analytics database script and try again.",
    );
    expectNoDirectWrites();
  });

  it("maps missing sales_trend_analytics relation errors", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message: 'relation "sales_trend_analytics" does not exist',
        code: "42P01",
      },
    });

    const result = await salesTrendAnalyticsService.getSalesTrendSummary();

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "Sales trend analytics is not available yet. Apply the sales trend analytics database script and try again.",
    );
    expectNoDirectWrites();
  });

  it("rejects null summary payloads", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: null,
    });

    const result = await salesTrendAnalyticsService.getSalesTrendSummary();

    expect(result.data).toBeNull();
    expect(result.error).toBe("Sales trend summary was not found.");
    expectNoDirectWrites();
  });

  it("rejects invalid summary payloads", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: summaryRow({ sale_count: -1 }),
      error: null,
    });

    const result = await salesTrendAnalyticsService.getSalesTrendSummary();

    expect(result.data).toBeNull();
    expect(result.error).toBe("Sales trend summary response was invalid.");
    expectNoDirectWrites();
  });

  it("is read-only and never writes tables", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: summaryRow(),
      error: null,
    });

    await salesTrendAnalyticsService.getSalesTrendSummary();

    expectReadOnly("get_sales_trend_summary");
  });
});
