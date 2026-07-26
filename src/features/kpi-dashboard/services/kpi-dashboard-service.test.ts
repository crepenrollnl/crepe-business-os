/**
 * Service-level coverage for kpiDashboardService (DEV-068).
 *
 * Reads must go only through get_kpi_dashboard RPC.
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

import { kpiDashboardService } from "./kpi-dashboard-service";
import type { KpiDashboard } from "../types/kpi-dashboard";

const insertMock = vi.fn();
const updateMock = vi.fn();
const deleteMock = vi.fn();

function dashboardRow(overrides?: Record<string, unknown>) {
  return {
    gross_revenue: "12500.50",
    total_orders: 100,
    average_order_value: "125.01",
    inventory_turnover: "2.5000",
    recipe_cost_average: "3.7500",
    supplier_count: 8,
    customer_count: 25,
    production_efficiency: "90.00",
    low_stock_ratio: "15.00",
    sales_growth: "12.50",
    ...overrides,
  };
}

function mappedDashboard(overrides?: Partial<KpiDashboard>): KpiDashboard {
  return {
    gross_revenue: 12500.5,
    total_orders: 100,
    average_order_value: 125.01,
    inventory_turnover: 2.5,
    recipe_cost_average: 3.75,
    supplier_count: 8,
    customer_count: 25,
    production_efficiency: 90,
    low_stock_ratio: 15,
    sales_growth: 12.5,
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
    "get_kpi_dashboard",
  ]);
  expect(supabaseMock.auth.getUser).not.toHaveBeenCalled();
  expectNoDirectWrites();
}

describe("kpiDashboardService.getKpiDashboard (DEV-068)", () => {
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

  it("retrieves KPI dashboard successfully via get_kpi_dashboard", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow(),
      error: null,
    });

    const result = await kpiDashboardService.getKpiDashboard();

    expect(result.error).toBeNull();
    expect(result.data).toEqual(mappedDashboard() satisfies KpiDashboard);
    expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
    expect(supabaseMock.rpc).toHaveBeenCalledWith("get_kpi_dashboard");
    expectReadOnly();
  });

  it("maps empty/default dashboard with zero metrics and null ratios", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow({
        gross_revenue: "0.00",
        total_orders: 0,
        average_order_value: "0.00",
        inventory_turnover: null,
        recipe_cost_average: null,
        supplier_count: 0,
        customer_count: 0,
        production_efficiency: null,
        low_stock_ratio: null,
        sales_growth: null,
      }),
      error: null,
    });

    const result = await kpiDashboardService.getKpiDashboard();

    expect(result.error).toBeNull();
    expect(result.data).toEqual(
      mappedDashboard({
        gross_revenue: 0,
        total_orders: 0,
        average_order_value: 0,
        inventory_turnover: null,
        recipe_cost_average: null,
        supplier_count: 0,
        customer_count: 0,
        production_efficiency: null,
        low_stock_ratio: null,
        sales_growth: null,
      }) satisfies KpiDashboard,
    );
    expectReadOnly();
  });

  it("maps RPC payload to typed KpiDashboard DTO", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow({
        gross_revenue: "999.99",
        total_orders: 9,
        average_order_value: "111.11",
        inventory_turnover: "1.2500",
        recipe_cost_average: "4.5000",
        supplier_count: 2,
        customer_count: 3,
        production_efficiency: "80.00",
        low_stock_ratio: "5.00",
        sales_growth: "-2.25",
      }),
      error: null,
    });

    const result = await kpiDashboardService.getKpiDashboard();

    expect(result.error).toBeNull();
    expect(result.data).toEqual(
      mappedDashboard({
        gross_revenue: 999.99,
        total_orders: 9,
        average_order_value: 111.11,
        inventory_turnover: 1.25,
        recipe_cost_average: 4.5,
        supplier_count: 2,
        customer_count: 3,
        production_efficiency: 80,
        low_stock_ratio: 5,
        sales_growth: -2.25,
      }) satisfies KpiDashboard,
    );
    expectReadOnly();
  });

  it("maps KPI metrics from SQL without recalculation", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow({
        gross_revenue: "5000.00",
        total_orders: 40,
        average_order_value: "999.99",
        inventory_turnover: "3.3333",
        recipe_cost_average: "7.7777",
        supplier_count: 11,
        customer_count: 22,
        production_efficiency: "66.66",
        low_stock_ratio: "33.33",
        sales_growth: "44.44",
      }),
      error: null,
    });

    const result = await kpiDashboardService.getKpiDashboard();

    expect(result.error).toBeNull();
    // Values come from the RPC as-is - never recomputed in TypeScript.
    expect(result.data?.gross_revenue).toBe(5000);
    expect(result.data?.total_orders).toBe(40);
    expect(result.data?.average_order_value).toBe(999.99);
    expect(result.data?.inventory_turnover).toBe(3.3333);
    expect(result.data?.recipe_cost_average).toBe(7.7777);
    expect(result.data?.supplier_count).toBe(11);
    expect(result.data?.customer_count).toBe(22);
    expect(result.data?.production_efficiency).toBe(66.66);
    expect(result.data?.low_stock_ratio).toBe(33.33);
    expect(result.data?.sales_growth).toBe(44.44);
    expectReadOnly();
  });

  it("maps missing get_kpi_dashboard function errors", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message: "Could not find the function public.get_kpi_dashboard",
      },
    });

    const result = await kpiDashboardService.getKpiDashboard();

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "KPI dashboard is not available yet. Apply the KPI dashboard database script and try again.",
    );
    expectNoDirectWrites();
  });

  it("maps missing kpi_dashboard relation errors", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message: 'relation "kpi_dashboard" does not exist',
        code: "42P01",
      },
    });

    const result = await kpiDashboardService.getKpiDashboard();

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "KPI dashboard is not available yet. Apply the KPI dashboard database script and try again.",
    );
    expectNoDirectWrites();
  });

  it("rejects invalid RPC payloads", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [],
      error: null,
    });

    const result = await kpiDashboardService.getKpiDashboard();

    expect(result.data).toBeNull();
    expect(result.error).toBe("KPI dashboard response was invalid.");
    expectNoDirectWrites();
  });

  it("rejects negative counts and missing metric fields", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow({ total_orders: -1 }),
      error: null,
    });
    const negativeOrders = await kpiDashboardService.getKpiDashboard();
    expect(negativeOrders.data).toBeNull();
    expect(negativeOrders.error).toBe("KPI dashboard response was invalid.");

    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow({ supplier_count: -2 }),
      error: null,
    });
    const negativeSuppliers = await kpiDashboardService.getKpiDashboard();
    expect(negativeSuppliers.data).toBeNull();
    expect(negativeSuppliers.error).toBe(
      "KPI dashboard response was invalid.",
    );

    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow({ gross_revenue: "not-a-number" }),
      error: null,
    });
    const badRevenue = await kpiDashboardService.getKpiDashboard();
    expect(badRevenue.data).toBeNull();
    expect(badRevenue.error).toBe("KPI dashboard response was invalid.");

    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow({ sales_growth: "not-a-number" }),
      error: null,
    });
    const badGrowth = await kpiDashboardService.getKpiDashboard();
    expect(badGrowth.data).toBeNull();
    expect(badGrowth.error).toBe("KPI dashboard response was invalid.");

    expectNoDirectWrites();
  });

  it("is read-only and never writes tables", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow(),
      error: null,
    });

    await kpiDashboardService.getKpiDashboard();

    expectReadOnly();
  });

  it("never queries KPI dashboard source tables directly", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow(),
      error: null,
    });

    await kpiDashboardService.getKpiDashboard();

    expect(supabaseMock.from).not.toHaveBeenCalledWith("kpi_dashboard");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("executive_dashboard");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("company_dashboard");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("production_dashboard");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("sales_trend_analytics");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("recipe_cost_analysis");
    expect(supabaseMock.from).not.toHaveBeenCalledWith(
      "report_purchase_summary",
    );
    expectNoDirectWrites();
  });
});
