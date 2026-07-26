/**
 * Service-level coverage for executiveDashboardService (DEV-067).
 *
 * Reads must go only through get_executive_dashboard RPC.
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

import { executiveDashboardService } from "./executive-dashboard-service";
import type {
  ExecutiveCompanyHealth,
  ExecutiveDashboard,
} from "../types/executive-dashboard";

const insertMock = vi.fn();
const updateMock = vi.fn();
const deleteMock = vi.fn();

function dashboardRow(overrides?: Record<string, unknown>) {
  return {
    company_health: "ok",
    inventory_value: "2450.5000",
    low_stock_count: 3,
    total_sales: 30,
    total_purchases: 15,
    total_batches: 10,
    sales_growth: "12.50",
    last_sale_date: "2026-07-25T16:00:00.000Z",
    last_purchase_date: "2026-07-24T10:00:00.000Z",
    last_production_date: "2026-07-23T12:00:00.000Z",
    ...overrides,
  };
}

function mappedDashboard(
  overrides?: Partial<ExecutiveDashboard>,
): ExecutiveDashboard {
  return {
    company_health: "ok",
    inventory_value: 2450.5,
    low_stock_count: 3,
    total_sales: 30,
    total_purchases: 15,
    total_batches: 10,
    sales_growth: 12.5,
    last_sale_date: "2026-07-25T16:00:00.000Z",
    last_purchase_date: "2026-07-24T10:00:00.000Z",
    last_production_date: "2026-07-23T12:00:00.000Z",
    ...overrides,
  };
}

function expectNoDirectWrites() {
  expect(supabaseMock.from).not.toHaveBeenCalled();
  expect(insertMock).not.toHaveBeenCalled();
  expect(updateMock).not.toHaveBeenCalled();
  expect(deleteMock).not.toHaveBeenCalled();
}

function expectReadOnly() {
  expect(supabaseMock.rpc.mock.calls.map((call) => call[0])).toEqual([
    "get_executive_dashboard",
  ]);
  expect(supabaseMock.auth.getUser).not.toHaveBeenCalled();
  expectNoDirectWrites();
}

describe("executiveDashboardService.getExecutiveDashboard (DEV-067)", () => {
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

  it("retrieves executive dashboard successfully via get_executive_dashboard", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow(),
      error: null,
    });

    const result = await executiveDashboardService.getExecutiveDashboard();

    expect(result.error).toBeNull();
    expect(result.data).toEqual(
      mappedDashboard() satisfies ExecutiveDashboard,
    );
    expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
    expect(supabaseMock.rpc).toHaveBeenCalledWith("get_executive_dashboard");
    expectReadOnly();
  });

  it("maps empty/default dashboard with zero metrics and null growth/dates", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow({
        company_health: "unknown",
        inventory_value: "0.0000",
        low_stock_count: 0,
        total_sales: 0,
        total_purchases: 0,
        total_batches: 0,
        sales_growth: null,
        last_sale_date: null,
        last_purchase_date: null,
        last_production_date: null,
      }),
      error: null,
    });

    const result = await executiveDashboardService.getExecutiveDashboard();

    expect(result.error).toBeNull();
    expect(result.data).toEqual(
      mappedDashboard({
        company_health: "unknown",
        inventory_value: 0,
        low_stock_count: 0,
        total_sales: 0,
        total_purchases: 0,
        total_batches: 0,
        sales_growth: null,
        last_sale_date: null,
        last_purchase_date: null,
        last_production_date: null,
      }) satisfies ExecutiveDashboard,
    );
    expectReadOnly();
  });

  it("maps RPC payload to typed ExecutiveDashboard DTO", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow({
        company_health: "attention",
        inventory_value: "99.9900",
        low_stock_count: 2,
        total_sales: 4,
        total_purchases: 1,
        total_batches: 7,
        sales_growth: "-5.25",
        last_sale_date: "2026-07-20T08:00:00.000Z",
        last_purchase_date: "2026-07-19T08:00:00.000Z",
        last_production_date: "2026-07-18T08:00:00.000Z",
      }),
      error: null,
    });

    const result = await executiveDashboardService.getExecutiveDashboard();

    expect(result.error).toBeNull();
    expect(result.data).toEqual(
      mappedDashboard({
        company_health: "attention",
        inventory_value: 99.99,
        low_stock_count: 2,
        total_sales: 4,
        total_purchases: 1,
        total_batches: 7,
        sales_growth: -5.25,
        last_sale_date: "2026-07-20T08:00:00.000Z",
        last_purchase_date: "2026-07-19T08:00:00.000Z",
        last_production_date: "2026-07-18T08:00:00.000Z",
      }) satisfies ExecutiveDashboard,
    );
    expectReadOnly();
  });

  it("maps executive dashboard metrics from SQL without recalculation", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow({
        company_health: "critical",
        inventory_value: "1234.5678",
        low_stock_count: 9,
        total_sales: 55,
        total_purchases: 66,
        total_batches: 77,
        sales_growth: "33.33",
        last_sale_date: "2026-06-01T00:00:00.000Z",
        last_purchase_date: "2026-06-02T00:00:00.000Z",
        last_production_date: "2026-06-03T00:00:00.000Z",
      }),
      error: null,
    });

    const result = await executiveDashboardService.getExecutiveDashboard();

    expect(result.error).toBeNull();
    // Values come from the RPC as-is - never recomputed in TypeScript.
    expect(result.data?.company_health).toBe("critical");
    expect(result.data?.inventory_value).toBe(1234.5678);
    expect(result.data?.low_stock_count).toBe(9);
    expect(result.data?.total_sales).toBe(55);
    expect(result.data?.total_purchases).toBe(66);
    expect(result.data?.total_batches).toBe(77);
    expect(result.data?.sales_growth).toBe(33.33);
    expect(result.data?.last_sale_date).toBe("2026-06-01T00:00:00.000Z");
    expect(result.data?.last_purchase_date).toBe("2026-06-02T00:00:00.000Z");
    expect(result.data?.last_production_date).toBe("2026-06-03T00:00:00.000Z");
    expectReadOnly();
  });

  it("maps ExecutiveCompanyHealth values without transformation", async () => {
    const healthValues: ExecutiveCompanyHealth[] = [
      "ok",
      "attention",
      "critical",
      "unknown",
    ];

    for (const companyHealth of healthValues) {
      supabaseMock.rpc.mockResolvedValue({
        data: dashboardRow({ company_health: companyHealth }),
        error: null,
      });

      const result = await executiveDashboardService.getExecutiveDashboard();

      expect(result.error).toBeNull();
      expect(result.data?.company_health).toBe(companyHealth);
    }

    expect(supabaseMock.rpc).toHaveBeenCalledTimes(healthValues.length);
    expect(supabaseMock.from).not.toHaveBeenCalled();
    expectNoDirectWrites();
  });

  it("maps missing get_executive_dashboard function errors", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message: "Could not find the function public.get_executive_dashboard",
      },
    });

    const result = await executiveDashboardService.getExecutiveDashboard();

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "Executive dashboard is not available yet. Apply the executive dashboard database script and try again.",
    );
    expectNoDirectWrites();
  });

  it("maps missing executive_dashboard relation errors", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message: 'relation "executive_dashboard" does not exist',
        code: "42P01",
      },
    });

    const result = await executiveDashboardService.getExecutiveDashboard();

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "Executive dashboard is not available yet. Apply the executive dashboard database script and try again.",
    );
    expectNoDirectWrites();
  });

  it("rejects invalid RPC payloads", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [],
      error: null,
    });

    const result = await executiveDashboardService.getExecutiveDashboard();

    expect(result.data).toBeNull();
    expect(result.error).toBe("Executive dashboard response was invalid.");
    expectNoDirectWrites();
  });

  it("rejects invalid company_health and metric fields", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow({ company_health: "healthy" }),
      error: null,
    });
    const badHealth = await executiveDashboardService.getExecutiveDashboard();
    expect(badHealth.data).toBeNull();
    expect(badHealth.error).toBe("Executive dashboard response was invalid.");

    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow({ low_stock_count: -1 }),
      error: null,
    });
    const negativeLow = await executiveDashboardService.getExecutiveDashboard();
    expect(negativeLow.data).toBeNull();
    expect(negativeLow.error).toBe(
      "Executive dashboard response was invalid.",
    );

    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow({ inventory_value: "not-a-number" }),
      error: null,
    });
    const badValue = await executiveDashboardService.getExecutiveDashboard();
    expect(badValue.data).toBeNull();
    expect(badValue.error).toBe("Executive dashboard response was invalid.");

    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow({ sales_growth: "not-a-number" }),
      error: null,
    });
    const badGrowth = await executiveDashboardService.getExecutiveDashboard();
    expect(badGrowth.data).toBeNull();
    expect(badGrowth.error).toBe("Executive dashboard response was invalid.");

    expectNoDirectWrites();
  });

  it("is read-only and never writes tables", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow(),
      error: null,
    });

    await executiveDashboardService.getExecutiveDashboard();

    expectReadOnly();
  });

  it("never queries executive dashboard source tables directly", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow(),
      error: null,
    });

    await executiveDashboardService.getExecutiveDashboard();

    expect(supabaseMock.from).not.toHaveBeenCalledWith("executive_dashboard");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("company_dashboard");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("inventory_dashboard");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("production_dashboard");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("sales_trend_analytics");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("sales");
    expectNoDirectWrites();
  });
});
