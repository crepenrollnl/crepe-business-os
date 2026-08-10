/**
 * Service-level coverage for dashboardService (DEV-042).
 *
 * Reads must go only through dashboard_summary.
 * The service must not query base/report tables, call RPCs, recalculate KPIs,
 * or mutate data.
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

import { dashboardService } from "./dashboard-service";
import type { DashboardSummary } from "../types/dashboard";

const insertMock = vi.fn();
const updateMock = vi.fn();
const deleteMock = vi.fn();

const DASHBOARD_SELECT = [
  "total_inventory_value",
  "inventory_items_below_minimum",
  "finished_goods_available",
  "total_sales_count",
  "total_purchase_count",
  "active_customers_count",
  "active_suppliers_count",
  "low_stock_items",
  "out_of_stock_items",
  "batches_in_progress",
  "finished_batches_today",
  "draft_sales_count",
  "confirmed_sales_today",
  "draft_purchase_count",
  "completed_purchases_today",
  "last_inventory_movement_at",
  "last_sale_at",
  "last_purchase_at",
].join(", ");

function summaryRow(overrides?: Record<string, unknown>) {
  return {
    total_inventory_value: "1250.5",
    inventory_items_below_minimum: "3",
    finished_goods_available: "42",
    total_sales_count: "10",
    total_purchase_count: "4",
    active_customers_count: "7",
    active_suppliers_count: "5",
    low_stock_items: "2",
    out_of_stock_items: "1",
    batches_in_progress: "0",
    finished_batches_today: "3",
    draft_sales_count: "1",
    confirmed_sales_today: "4",
    draft_purchase_count: "0",
    completed_purchases_today: "2",
    last_inventory_movement_at: null,
    last_sale_at: null,
    last_purchase_at: null,
    ...overrides,
  };
}

function forbidOtherTables(table: string) {
  if (table !== "dashboard_summary") {
    throw new Error(`Unexpected table: ${table}`);
  }
}

function mockDashboardView(
  row: Record<string, unknown> | null,
  error: unknown = null,
) {
  const maybeSingleMock = vi.fn().mockResolvedValue({
    data: error ? null : row,
    error,
  });
  const selectMock = vi.fn().mockReturnValue({
    maybeSingle: maybeSingleMock,
  });

  supabaseMock.from.mockImplementation((table: string) => {
    forbidOtherTables(table);

    return {
      select: selectMock,
      insert: insertMock,
      update: updateMock,
      delete: deleteMock,
    };
  });

  return { selectMock, maybeSingleMock };
}

function expectReadOnly() {
  const tablesTouched = supabaseMock.from.mock.calls.map(
    (call) => call[0] as string,
  );
  expect(tablesTouched).toEqual(["dashboard_summary"]);
  expect(tablesTouched).not.toContain("ingredients");
  expect(tablesTouched).not.toContain("purchases");
  expect(tablesTouched).not.toContain("sales");
  expect(tablesTouched).not.toContain("report_inventory_summary");
  expect(tablesTouched).not.toContain("report_finished_goods_summary");
  expect(tablesTouched).not.toContain("report_sales_summary");
  expect(tablesTouched).not.toContain("report_purchase_summary");
  expect(tablesTouched).not.toContain("customers");
  expect(tablesTouched).not.toContain("suppliers");
  expect(supabaseMock.rpc).not.toHaveBeenCalled();
  expect(insertMock).not.toHaveBeenCalled();
  expect(updateMock).not.toHaveBeenCalled();
  expect(deleteMock).not.toHaveBeenCalled();
}

describe("dashboardService.getDashboardSummary (DEV-042)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertMock.mockReset();
    updateMock.mockReset();
    deleteMock.mockReset();
  });

  it("queries only dashboard_summary and returns a typed DashboardSummary", async () => {
    const { selectMock, maybeSingleMock } = mockDashboardView(summaryRow());

    const result = await dashboardService.getDashboardSummary();

    expect(result.error).toBeNull();
    expect(result.data).toEqual({
      total_inventory_value: 1250.5,
      inventory_items_below_minimum: 3,
      finished_goods_available: 42,
      total_sales_count: 10,
      total_purchase_count: 4,
      active_customers_count: 7,
      active_suppliers_count: 5,
      low_stock_items: 2,
      out_of_stock_items: 1,
      batches_in_progress: 0,
      finished_batches_today: 3,
      draft_sales_count: 1,
      confirmed_sales_today: 4,
      draft_purchase_count: 0,
      completed_purchases_today: 2,
      last_inventory_movement_at: null,
      last_sale_at: null,
      last_purchase_at: null,
    } satisfies DashboardSummary);
    expect(supabaseMock.from).toHaveBeenCalledTimes(1);
    expect(supabaseMock.from).toHaveBeenCalledWith("dashboard_summary");
    expect(selectMock).toHaveBeenCalledWith(DASHBOARD_SELECT);
    expect(maybeSingleMock).toHaveBeenCalledTimes(1);
    expectReadOnly();
  });

  it("maps empty dashboard result as not found", async () => {
    mockDashboardView(null);

    const result = await dashboardService.getDashboardSummary();

    expect(result.data).toBeNull();
    expect(result.error).toBe("Dashboard summary was not found.");
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("maps missing-view errors", async () => {
    mockDashboardView(null, {
      message: 'relation "dashboard_summary" does not exist',
      code: "42P01",
    });

    const result = await dashboardService.getDashboardSummary();

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "Dashboard summary is not available yet. Apply the dashboard foundation database script and try again.",
    );
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it("does not recalculate KPIs in TypeScript", async () => {
    mockDashboardView(
      summaryRow({
        total_inventory_value: "999",
        inventory_items_below_minimum: "1",
        finished_goods_available: "0",
        total_sales_count: "2",
        total_purchase_count: "3",
        active_customers_count: "4",
        active_suppliers_count: "5",
      }),
    );

    const result = await dashboardService.getDashboardSummary();

    expect(result.error).toBeNull();
    // Values come from the view as-is — never recomputed from other modules.
    expect(result.data?.total_inventory_value).toBe(999);
    expect(result.data?.finished_goods_available).toBe(0);
    expect(result.data?.total_sales_count).toBe(2);
    expectReadOnly();
  });

  it("never mutates data", async () => {
    mockDashboardView(summaryRow());

    await dashboardService.getDashboardSummary();

    expect(supabaseMock.rpc).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
    expectReadOnly();
  });
});
