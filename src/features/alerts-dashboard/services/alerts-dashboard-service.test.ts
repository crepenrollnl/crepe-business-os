/**
 * Service-level coverage for alertsDashboardService (DEV-069).
 *
 * Reads must go only through get_alerts_dashboard RPC.
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

import { alertsDashboardService } from "./alerts-dashboard-service";
import type { AlertsDashboard } from "../types/alerts-dashboard";

const insertMock = vi.fn();
const updateMock = vi.fn();
const deleteMock = vi.fn();

function dashboardRow(overrides?: Record<string, unknown>) {
  return {
    low_stock_alerts: 3,
    out_of_stock_alerts: 1,
    overdue_production: 2,
    failed_batches: 4,
    stale_purchase_prices: 5,
    inactive_suppliers: 2,
    declining_sales: true,
    missing_company_settings: false,
    backup_status: "ok",
    import_export_failures: 6,
    ...overrides,
  };
}

function mappedDashboard(
  overrides?: Partial<AlertsDashboard>,
): AlertsDashboard {
  return {
    low_stock_alerts: 3,
    out_of_stock_alerts: 1,
    overdue_production: 2,
    failed_batches: 4,
    stale_purchase_prices: 5,
    inactive_suppliers: 2,
    declining_sales: true,
    missing_company_settings: false,
    backup_status: "ok",
    import_export_failures: 6,
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
    "get_alerts_dashboard",
  ]);
  expect(supabaseMock.auth.getUser).not.toHaveBeenCalled();
  expectNoDirectWrites();
}

describe("alertsDashboardService.getAlertsDashboard (DEV-069)", () => {
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

  it("retrieves alerts dashboard successfully via get_alerts_dashboard", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow(),
      error: null,
    });

    const result = await alertsDashboardService.getAlertsDashboard();

    expect(result.error).toBeNull();
    expect(result.data).toEqual(mappedDashboard() satisfies AlertsDashboard);
    expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
    expect(supabaseMock.rpc).toHaveBeenCalledWith("get_alerts_dashboard");
    expectReadOnly();
  });

  it("maps empty/default dashboard with zero alerts and clear flags", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow({
        low_stock_alerts: 0,
        out_of_stock_alerts: 0,
        overdue_production: 0,
        failed_batches: 0,
        stale_purchase_prices: 0,
        inactive_suppliers: 0,
        declining_sales: false,
        missing_company_settings: false,
        backup_status: "unknown",
        import_export_failures: 0,
      }),
      error: null,
    });

    const result = await alertsDashboardService.getAlertsDashboard();

    expect(result.error).toBeNull();
    expect(result.data).toEqual(
      mappedDashboard({
        low_stock_alerts: 0,
        out_of_stock_alerts: 0,
        overdue_production: 0,
        failed_batches: 0,
        stale_purchase_prices: 0,
        inactive_suppliers: 0,
        declining_sales: false,
        missing_company_settings: false,
        backup_status: "unknown",
        import_export_failures: 0,
      }) satisfies AlertsDashboard,
    );
    expectReadOnly();
  });

  it("maps RPC payload to typed AlertsDashboard DTO", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow({
        low_stock_alerts: 7,
        out_of_stock_alerts: 8,
        overdue_production: 1,
        failed_batches: 0,
        stale_purchase_prices: 9,
        inactive_suppliers: 3,
        declining_sales: false,
        missing_company_settings: true,
        backup_status: "degraded",
        import_export_failures: 2,
      }),
      error: null,
    });

    const result = await alertsDashboardService.getAlertsDashboard();

    expect(result.error).toBeNull();
    expect(result.data).toEqual(
      mappedDashboard({
        low_stock_alerts: 7,
        out_of_stock_alerts: 8,
        overdue_production: 1,
        failed_batches: 0,
        stale_purchase_prices: 9,
        inactive_suppliers: 3,
        declining_sales: false,
        missing_company_settings: true,
        backup_status: "degraded",
        import_export_failures: 2,
      }) satisfies AlertsDashboard,
    );
    expectReadOnly();
  });

  it("maps alert fields from SQL without recalculation", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow({
        low_stock_alerts: 11,
        out_of_stock_alerts: 22,
        overdue_production: 33,
        failed_batches: 44,
        stale_purchase_prices: 55,
        inactive_suppliers: 66,
        declining_sales: true,
        missing_company_settings: true,
        backup_status: "degraded",
        import_export_failures: 77,
      }),
      error: null,
    });

    const result = await alertsDashboardService.getAlertsDashboard();

    expect(result.error).toBeNull();
    // Values come from the RPC as-is - never recomputed in TypeScript.
    expect(result.data?.low_stock_alerts).toBe(11);
    expect(result.data?.out_of_stock_alerts).toBe(22);
    expect(result.data?.overdue_production).toBe(33);
    expect(result.data?.failed_batches).toBe(44);
    expect(result.data?.stale_purchase_prices).toBe(55);
    expect(result.data?.inactive_suppliers).toBe(66);
    expect(result.data?.declining_sales).toBe(true);
    expect(result.data?.missing_company_settings).toBe(true);
    expect(result.data?.backup_status).toBe("degraded");
    // Approved SQL/DTO expose combined import/export failure count.
    expect(result.data?.import_export_failures).toBe(77);
    expectReadOnly();
  });

  it("maps missing get_alerts_dashboard function errors", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message: "Could not find the function public.get_alerts_dashboard",
      },
    });

    const result = await alertsDashboardService.getAlertsDashboard();

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "Alerts dashboard is not available yet. Apply the alerts dashboard database script and try again.",
    );
    expectNoDirectWrites();
  });

  it("maps missing alerts_dashboard relation errors", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message: 'relation "alerts_dashboard" does not exist',
        code: "42P01",
      },
    });

    const result = await alertsDashboardService.getAlertsDashboard();

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "Alerts dashboard is not available yet. Apply the alerts dashboard database script and try again.",
    );
    expectNoDirectWrites();
  });

  it("rejects invalid RPC payloads", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [],
      error: null,
    });

    const result = await alertsDashboardService.getAlertsDashboard();

    expect(result.data).toBeNull();
    expect(result.error).toBe("Alerts dashboard response was invalid.");
    expectNoDirectWrites();
  });

  it("rejects negative counts and invalid flag/status fields", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow({ low_stock_alerts: -1 }),
      error: null,
    });
    const negativeLow = await alertsDashboardService.getAlertsDashboard();
    expect(negativeLow.data).toBeNull();
    expect(negativeLow.error).toBe("Alerts dashboard response was invalid.");

    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow({ import_export_failures: -2 }),
      error: null,
    });
    const negativeFailures = await alertsDashboardService.getAlertsDashboard();
    expect(negativeFailures.data).toBeNull();
    expect(negativeFailures.error).toBe(
      "Alerts dashboard response was invalid.",
    );

    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow({ declining_sales: "yes" }),
      error: null,
    });
    const badFlag = await alertsDashboardService.getAlertsDashboard();
    expect(badFlag.data).toBeNull();
    expect(badFlag.error).toBe("Alerts dashboard response was invalid.");

    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow({ backup_status: "" }),
      error: null,
    });
    const blankStatus = await alertsDashboardService.getAlertsDashboard();
    expect(blankStatus.data).toBeNull();
    expect(blankStatus.error).toBe("Alerts dashboard response was invalid.");

    expectNoDirectWrites();
  });

  it("is read-only and never writes tables", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow(),
      error: null,
    });

    await alertsDashboardService.getAlertsDashboard();

    expectReadOnly();
  });

  it("never queries alerts dashboard source tables directly", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow(),
      error: null,
    });

    await alertsDashboardService.getAlertsDashboard();

    expect(supabaseMock.from).not.toHaveBeenCalledWith("alerts_dashboard");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("inventory_dashboard");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("production_dashboard");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("executive_dashboard");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("system_health");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("import_jobs");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("export_jobs");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("suppliers");
    expectNoDirectWrites();
  });
});
