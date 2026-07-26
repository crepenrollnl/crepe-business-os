/**
 * Service-level coverage for companyDashboardService (DEV-066).
 *
 * Reads must go only through get_company_dashboard RPC.
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

import { companyDashboardService } from "./company-dashboard-service";
import type { CompanyDashboard } from "../types/company-dashboard";

const insertMock = vi.fn();
const updateMock = vi.fn();
const deleteMock = vi.fn();

function dashboardRow(overrides?: Record<string, unknown>) {
  return {
    total_suppliers: 5,
    total_customers: 12,
    total_recipes: 8,
    total_ingredients: 20,
    total_finished_goods: "450.000",
    total_sales: 30,
    total_purchases: 15,
    total_production_batches: 10,
    last_sale_date: "2026-07-25T16:00:00.000Z",
    last_purchase_date: "2026-07-24T10:00:00.000Z",
    last_production_date: "2026-07-23T12:00:00.000Z",
    ...overrides,
  };
}

function mappedDashboard(
  overrides?: Partial<CompanyDashboard>,
): CompanyDashboard {
  return {
    total_suppliers: 5,
    total_customers: 12,
    total_recipes: 8,
    total_ingredients: 20,
    total_finished_goods: 450,
    total_sales: 30,
    total_purchases: 15,
    total_production_batches: 10,
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
    "get_company_dashboard",
  ]);
  expect(supabaseMock.auth.getUser).not.toHaveBeenCalled();
  expectNoDirectWrites();
}

describe("companyDashboardService.getCompanyDashboard (DEV-066)", () => {
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

  it("retrieves company dashboard successfully via get_company_dashboard", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow(),
      error: null,
    });

    const result = await companyDashboardService.getCompanyDashboard();

    expect(result.error).toBeNull();
    expect(result.data).toEqual(mappedDashboard() satisfies CompanyDashboard);
    expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
    expect(supabaseMock.rpc).toHaveBeenCalledWith("get_company_dashboard");
    expectReadOnly();
  });

  it("maps empty/default dashboard with zero metrics and null dates", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow({
        total_suppliers: 0,
        total_customers: 0,
        total_recipes: 0,
        total_ingredients: 0,
        total_finished_goods: "0.000",
        total_sales: 0,
        total_purchases: 0,
        total_production_batches: 0,
        last_sale_date: null,
        last_purchase_date: null,
        last_production_date: null,
      }),
      error: null,
    });

    const result = await companyDashboardService.getCompanyDashboard();

    expect(result.error).toBeNull();
    expect(result.data).toEqual(
      mappedDashboard({
        total_suppliers: 0,
        total_customers: 0,
        total_recipes: 0,
        total_ingredients: 0,
        total_finished_goods: 0,
        total_sales: 0,
        total_purchases: 0,
        total_production_batches: 0,
        last_sale_date: null,
        last_purchase_date: null,
        last_production_date: null,
      }) satisfies CompanyDashboard,
    );
    expectReadOnly();
  });

  it("maps RPC payload to typed CompanyDashboard DTO", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow({
        total_suppliers: 2,
        total_customers: 4,
        total_recipes: 6,
        total_ingredients: 8,
        total_finished_goods: "99.500",
        total_sales: 3,
        total_purchases: 1,
        total_production_batches: 7,
        last_sale_date: "2026-07-20T08:00:00.000Z",
        last_purchase_date: "2026-07-19T08:00:00.000Z",
        last_production_date: "2026-07-18T08:00:00.000Z",
      }),
      error: null,
    });

    const result = await companyDashboardService.getCompanyDashboard();

    expect(result.error).toBeNull();
    expect(result.data).toEqual(
      mappedDashboard({
        total_suppliers: 2,
        total_customers: 4,
        total_recipes: 6,
        total_ingredients: 8,
        total_finished_goods: 99.5,
        total_sales: 3,
        total_purchases: 1,
        total_production_batches: 7,
        last_sale_date: "2026-07-20T08:00:00.000Z",
        last_purchase_date: "2026-07-19T08:00:00.000Z",
        last_production_date: "2026-07-18T08:00:00.000Z",
      }) satisfies CompanyDashboard,
    );
    expectReadOnly();
  });

  it("maps dashboard metrics from SQL without recalculation", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow({
        total_suppliers: 11,
        total_customers: 22,
        total_recipes: 33,
        total_ingredients: 44,
        total_finished_goods: "1234.567",
        total_sales: 55,
        total_purchases: 66,
        total_production_batches: 77,
        last_sale_date: "2026-06-01T00:00:00.000Z",
        last_purchase_date: "2026-06-02T00:00:00.000Z",
        last_production_date: "2026-06-03T00:00:00.000Z",
      }),
      error: null,
    });

    const result = await companyDashboardService.getCompanyDashboard();

    expect(result.error).toBeNull();
    // Values come from the RPC as-is - never recomputed in TypeScript.
    expect(result.data?.total_suppliers).toBe(11);
    expect(result.data?.total_customers).toBe(22);
    expect(result.data?.total_recipes).toBe(33);
    expect(result.data?.total_ingredients).toBe(44);
    expect(result.data?.total_finished_goods).toBe(1234.567);
    expect(result.data?.total_sales).toBe(55);
    expect(result.data?.total_purchases).toBe(66);
    expect(result.data?.total_production_batches).toBe(77);
    expect(result.data?.last_sale_date).toBe("2026-06-01T00:00:00.000Z");
    expect(result.data?.last_purchase_date).toBe("2026-06-02T00:00:00.000Z");
    expect(result.data?.last_production_date).toBe("2026-06-03T00:00:00.000Z");
    expectReadOnly();
  });

  it("maps missing get_company_dashboard function errors", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message: "Could not find the function public.get_company_dashboard",
      },
    });

    const result = await companyDashboardService.getCompanyDashboard();

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "Company dashboard is not available yet. Apply the company dashboard database script and try again.",
    );
    expectNoDirectWrites();
  });

  it("maps missing company_dashboard relation errors", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message: 'relation "company_dashboard" does not exist',
        code: "42P01",
      },
    });

    const result = await companyDashboardService.getCompanyDashboard();

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "Company dashboard is not available yet. Apply the company dashboard database script and try again.",
    );
    expectNoDirectWrites();
  });

  it("rejects invalid RPC payloads", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [],
      error: null,
    });

    const result = await companyDashboardService.getCompanyDashboard();

    expect(result.data).toBeNull();
    expect(result.error).toBe("Company dashboard response was invalid.");
    expectNoDirectWrites();
  });

  it("rejects negative counts and missing metric fields", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow({ total_suppliers: -1 }),
      error: null,
    });
    const negativeSuppliers =
      await companyDashboardService.getCompanyDashboard();
    expect(negativeSuppliers.data).toBeNull();
    expect(negativeSuppliers.error).toBe(
      "Company dashboard response was invalid.",
    );

    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow({ total_customers: -2 }),
      error: null,
    });
    const negativeCustomers =
      await companyDashboardService.getCompanyDashboard();
    expect(negativeCustomers.data).toBeNull();
    expect(negativeCustomers.error).toBe(
      "Company dashboard response was invalid.",
    );

    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow({ total_finished_goods: "not-a-number" }),
      error: null,
    });
    const badGoods = await companyDashboardService.getCompanyDashboard();
    expect(badGoods.data).toBeNull();
    expect(badGoods.error).toBe("Company dashboard response was invalid.");

    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow({ total_production_batches: -3 }),
      error: null,
    });
    const negativeBatches = await companyDashboardService.getCompanyDashboard();
    expect(negativeBatches.data).toBeNull();
    expect(negativeBatches.error).toBe(
      "Company dashboard response was invalid.",
    );

    expectNoDirectWrites();
  });

  it("is read-only and never writes tables", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow(),
      error: null,
    });

    await companyDashboardService.getCompanyDashboard();

    expectReadOnly();
  });

  it("never queries company dashboard source tables directly", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow(),
      error: null,
    });

    await companyDashboardService.getCompanyDashboard();

    expect(supabaseMock.from).not.toHaveBeenCalledWith("company_dashboard");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("inventory_dashboard");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("production_dashboard");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("suppliers");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("customers");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("recipes");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("sales");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("purchases");
    expectNoDirectWrites();
  });
});
