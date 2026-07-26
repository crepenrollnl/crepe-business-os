/**
 * Service-level coverage for productionDashboardService (DEV-065).
 *
 * Reads must go only through get_production_dashboard RPC.
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

import { productionDashboardService } from "./production-dashboard-service";
import type { ProductionDashboard } from "../types/production-dashboard";

const insertMock = vi.fn();
const updateMock = vi.fn();
const deleteMock = vi.fn();

function dashboardRow(overrides?: Record<string, unknown>) {
  return {
    total_batches: 10,
    completed_batches: 8,
    failed_batches: 2,
    total_finished_goods: "250.000",
    last_production_date: "2026-07-25T16:00:00.000Z",
    average_batch_duration: "1800.50",
    ...overrides,
  };
}

function mappedDashboard(
  overrides?: Partial<ProductionDashboard>,
): ProductionDashboard {
  return {
    total_batches: 10,
    completed_batches: 8,
    failed_batches: 2,
    total_finished_goods: 250,
    last_production_date: "2026-07-25T16:00:00.000Z",
    average_batch_duration: 1800.5,
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
    "get_production_dashboard",
  ]);
  expect(supabaseMock.auth.getUser).not.toHaveBeenCalled();
  expectNoDirectWrites();
}

describe("productionDashboardService.getProductionDashboard (DEV-065)", () => {
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

  it("retrieves production dashboard successfully via get_production_dashboard", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow(),
      error: null,
    });

    const result = await productionDashboardService.getProductionDashboard();

    expect(result.error).toBeNull();
    expect(result.data).toEqual(
      mappedDashboard() satisfies ProductionDashboard,
    );
    expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
    expect(supabaseMock.rpc).toHaveBeenCalledWith("get_production_dashboard");
    expectReadOnly();
  });

  it("maps empty/default dashboard with zero metrics and null dates/duration", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow({
        total_batches: 0,
        completed_batches: 0,
        failed_batches: 0,
        total_finished_goods: "0.000",
        last_production_date: null,
        average_batch_duration: null,
      }),
      error: null,
    });

    const result = await productionDashboardService.getProductionDashboard();

    expect(result.error).toBeNull();
    expect(result.data).toEqual(
      mappedDashboard({
        total_batches: 0,
        completed_batches: 0,
        failed_batches: 0,
        total_finished_goods: 0,
        last_production_date: null,
        average_batch_duration: null,
      }) satisfies ProductionDashboard,
    );
    expectReadOnly();
  });

  it("maps RPC payload to typed ProductionDashboard DTO", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow({
        total_batches: 4,
        completed_batches: 3,
        failed_batches: 1,
        total_finished_goods: "99.500",
        last_production_date: "2026-07-20T08:00:00.000Z",
        average_batch_duration: "900.00",
      }),
      error: null,
    });

    const result = await productionDashboardService.getProductionDashboard();

    expect(result.error).toBeNull();
    expect(result.data).toEqual(
      mappedDashboard({
        total_batches: 4,
        completed_batches: 3,
        failed_batches: 1,
        total_finished_goods: 99.5,
        last_production_date: "2026-07-20T08:00:00.000Z",
        average_batch_duration: 900,
      }) satisfies ProductionDashboard,
    );
    expectReadOnly();
  });

  it("maps dashboard metrics from SQL without recalculation", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow({
        total_batches: 5,
        completed_batches: 9,
        failed_batches: 7,
        total_finished_goods: "1234.567",
        last_production_date: "2026-06-01T00:00:00.000Z",
        average_batch_duration: "3600.25",
      }),
      error: null,
    });

    const result = await productionDashboardService.getProductionDashboard();

    expect(result.error).toBeNull();
    // Values come from the RPC as-is - never recomputed in TypeScript.
    expect(result.data?.total_batches).toBe(5);
    expect(result.data?.completed_batches).toBe(9);
    expect(result.data?.failed_batches).toBe(7);
    expect(result.data?.total_finished_goods).toBe(1234.567);
    expect(result.data?.last_production_date).toBe("2026-06-01T00:00:00.000Z");
    expect(result.data?.average_batch_duration).toBe(3600.25);
    expectReadOnly();
  });

  it("maps missing get_production_dashboard function errors", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message: "Could not find the function public.get_production_dashboard",
      },
    });

    const result = await productionDashboardService.getProductionDashboard();

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "Production dashboard is not available yet. Apply the production dashboard database script and try again.",
    );
    expectNoDirectWrites();
  });

  it("maps missing production_dashboard relation errors", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message: 'relation "production_dashboard" does not exist',
        code: "42P01",
      },
    });

    const result = await productionDashboardService.getProductionDashboard();

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "Production dashboard is not available yet. Apply the production dashboard database script and try again.",
    );
    expectNoDirectWrites();
  });

  it("rejects invalid RPC payloads", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [],
      error: null,
    });

    const result = await productionDashboardService.getProductionDashboard();

    expect(result.data).toBeNull();
    expect(result.error).toBe("Production dashboard response was invalid.");
    expectNoDirectWrites();
  });

  it("rejects negative counts and missing metric fields", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow({ total_batches: -1 }),
      error: null,
    });
    const negativeTotal =
      await productionDashboardService.getProductionDashboard();
    expect(negativeTotal.data).toBeNull();
    expect(negativeTotal.error).toBe(
      "Production dashboard response was invalid.",
    );

    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow({ completed_batches: -2 }),
      error: null,
    });
    const negativeCompleted =
      await productionDashboardService.getProductionDashboard();
    expect(negativeCompleted.data).toBeNull();
    expect(negativeCompleted.error).toBe(
      "Production dashboard response was invalid.",
    );

    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow({ failed_batches: -3 }),
      error: null,
    });
    const negativeFailed =
      await productionDashboardService.getProductionDashboard();
    expect(negativeFailed.data).toBeNull();
    expect(negativeFailed.error).toBe(
      "Production dashboard response was invalid.",
    );

    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow({ total_finished_goods: "not-a-number" }),
      error: null,
    });
    const badGoods = await productionDashboardService.getProductionDashboard();
    expect(badGoods.data).toBeNull();
    expect(badGoods.error).toBe("Production dashboard response was invalid.");

    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow({ average_batch_duration: "not-a-number" }),
      error: null,
    });
    const badDuration =
      await productionDashboardService.getProductionDashboard();
    expect(badDuration.data).toBeNull();
    expect(badDuration.error).toBe(
      "Production dashboard response was invalid.",
    );

    expectNoDirectWrites();
  });

  it("is read-only and never writes tables", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow(),
      error: null,
    });

    await productionDashboardService.getProductionDashboard();

    expectReadOnly();
  });

  it("never queries production dashboard source tables directly", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow(),
      error: null,
    });

    await productionDashboardService.getProductionDashboard();

    expect(supabaseMock.from).not.toHaveBeenCalledWith("production_dashboard");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("production_batches");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("production_sessions");
    expect(supabaseMock.from).not.toHaveBeenCalledWith(
      "production_session_lines",
    );
    expectNoDirectWrites();
  });
});
