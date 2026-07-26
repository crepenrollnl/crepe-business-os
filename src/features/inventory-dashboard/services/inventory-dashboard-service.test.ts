/**
 * Service-level coverage for inventoryDashboardService (DEV-064).
 *
 * Reads must go only through get_inventory_dashboard RPC.
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

import { inventoryDashboardService } from "./inventory-dashboard-service";
import type { InventoryDashboard } from "../types/inventory-dashboard";

const insertMock = vi.fn();
const updateMock = vi.fn();
const deleteMock = vi.fn();

function dashboardRow(overrides?: Record<string, unknown>) {
  return {
    total_ingredients: 12,
    low_stock_count: 3,
    out_of_stock_count: 1,
    total_inventory_value: "2450.5000",
    last_purchase_date: "2026-07-24T10:00:00.000Z",
    last_production_date: "2026-07-25T16:00:00.000Z",
    ...overrides,
  };
}

function mappedDashboard(
  overrides?: Partial<InventoryDashboard>,
): InventoryDashboard {
  return {
    total_ingredients: 12,
    low_stock_count: 3,
    out_of_stock_count: 1,
    total_inventory_value: 2450.5,
    last_purchase_date: "2026-07-24T10:00:00.000Z",
    last_production_date: "2026-07-25T16:00:00.000Z",
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
    "get_inventory_dashboard",
  ]);
  expect(supabaseMock.auth.getUser).not.toHaveBeenCalled();
  expectNoDirectWrites();
}

describe("inventoryDashboardService.getInventoryDashboard (DEV-064)", () => {
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

  it("retrieves inventory dashboard successfully via get_inventory_dashboard", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow(),
      error: null,
    });

    const result = await inventoryDashboardService.getInventoryDashboard();

    expect(result.error).toBeNull();
    expect(result.data).toEqual(
      mappedDashboard() satisfies InventoryDashboard,
    );
    expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
    expect(supabaseMock.rpc).toHaveBeenCalledWith("get_inventory_dashboard");
    expectReadOnly();
  });

  it("maps empty/default dashboard with zero metrics and null dates", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow({
        total_ingredients: 0,
        low_stock_count: 0,
        out_of_stock_count: 0,
        total_inventory_value: "0.0000",
        last_purchase_date: null,
        last_production_date: null,
      }),
      error: null,
    });

    const result = await inventoryDashboardService.getInventoryDashboard();

    expect(result.error).toBeNull();
    expect(result.data).toEqual(
      mappedDashboard({
        total_ingredients: 0,
        low_stock_count: 0,
        out_of_stock_count: 0,
        total_inventory_value: 0,
        last_purchase_date: null,
        last_production_date: null,
      }) satisfies InventoryDashboard,
    );
    expectReadOnly();
  });

  it("maps RPC payload to typed InventoryDashboard DTO", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow({
        total_ingredients: 8,
        low_stock_count: 2,
        out_of_stock_count: 4,
        total_inventory_value: "99.9900",
        last_purchase_date: "2026-07-20T08:00:00.000Z",
        last_production_date: "2026-07-21T12:00:00.000Z",
      }),
      error: null,
    });

    const result = await inventoryDashboardService.getInventoryDashboard();

    expect(result.error).toBeNull();
    expect(result.data).toEqual(
      mappedDashboard({
        total_ingredients: 8,
        low_stock_count: 2,
        out_of_stock_count: 4,
        total_inventory_value: 99.99,
        last_purchase_date: "2026-07-20T08:00:00.000Z",
        last_production_date: "2026-07-21T12:00:00.000Z",
      }) satisfies InventoryDashboard,
    );
    expectReadOnly();
  });

  it("maps dashboard metrics from SQL without recalculation", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow({
        total_ingredients: 5,
        low_stock_count: 9,
        out_of_stock_count: 7,
        total_inventory_value: "1234.5678",
        last_purchase_date: "2026-06-01T00:00:00.000Z",
        last_production_date: "2026-06-15T00:00:00.000Z",
      }),
      error: null,
    });

    const result = await inventoryDashboardService.getInventoryDashboard();

    expect(result.error).toBeNull();
    // Values come from the RPC as-is - never recomputed in TypeScript.
    expect(result.data?.total_ingredients).toBe(5);
    expect(result.data?.low_stock_count).toBe(9);
    expect(result.data?.out_of_stock_count).toBe(7);
    expect(result.data?.total_inventory_value).toBe(1234.5678);
    expect(result.data?.last_purchase_date).toBe("2026-06-01T00:00:00.000Z");
    expect(result.data?.last_production_date).toBe("2026-06-15T00:00:00.000Z");
    expectReadOnly();
  });

  it("maps missing get_inventory_dashboard function errors", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message: "Could not find the function public.get_inventory_dashboard",
      },
    });

    const result = await inventoryDashboardService.getInventoryDashboard();

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "Inventory dashboard is not available yet. Apply the inventory dashboard database script and try again.",
    );
    expectNoDirectWrites();
  });

  it("maps missing inventory_dashboard relation errors", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message: 'relation "inventory_dashboard" does not exist',
        code: "42P01",
      },
    });

    const result = await inventoryDashboardService.getInventoryDashboard();

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "Inventory dashboard is not available yet. Apply the inventory dashboard database script and try again.",
    );
    expectNoDirectWrites();
  });

  it("rejects invalid RPC payloads", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [],
      error: null,
    });

    const result = await inventoryDashboardService.getInventoryDashboard();

    expect(result.data).toBeNull();
    expect(result.error).toBe("Inventory dashboard response was invalid.");
    expectNoDirectWrites();
  });

  it("rejects negative counts and missing metric fields", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow({ total_ingredients: -1 }),
      error: null,
    });
    const negativeTotal = await inventoryDashboardService.getInventoryDashboard();
    expect(negativeTotal.data).toBeNull();
    expect(negativeTotal.error).toBe(
      "Inventory dashboard response was invalid.",
    );

    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow({ low_stock_count: -2 }),
      error: null,
    });
    const negativeLow = await inventoryDashboardService.getInventoryDashboard();
    expect(negativeLow.data).toBeNull();
    expect(negativeLow.error).toBe(
      "Inventory dashboard response was invalid.",
    );

    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow({ out_of_stock_count: -3 }),
      error: null,
    });
    const negativeOut = await inventoryDashboardService.getInventoryDashboard();
    expect(negativeOut.data).toBeNull();
    expect(negativeOut.error).toBe(
      "Inventory dashboard response was invalid.",
    );

    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow({ total_inventory_value: "not-a-number" }),
      error: null,
    });
    const badValue = await inventoryDashboardService.getInventoryDashboard();
    expect(badValue.data).toBeNull();
    expect(badValue.error).toBe("Inventory dashboard response was invalid.");

    expectNoDirectWrites();
  });

  it("is read-only and never writes tables", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow(),
      error: null,
    });

    await inventoryDashboardService.getInventoryDashboard();

    expectReadOnly();
  });

  it("never queries inventory dashboard source tables directly", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow(),
      error: null,
    });

    await inventoryDashboardService.getInventoryDashboard();

    expect(supabaseMock.from).not.toHaveBeenCalledWith("inventory_dashboard");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("inventory_alerts");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("inventory_valuation");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("ingredients");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("production_sessions");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("purchases");
    expectNoDirectWrites();
  });
});
