/**
 * Service-level coverage for auditDashboardService (DEV-070).
 *
 * Reads must go only through get_audit_dashboard RPC.
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

import { auditDashboardService } from "./audit-dashboard-service";
import type { AuditDashboard } from "../types/audit-dashboard";

const insertMock = vi.fn();
const updateMock = vi.fn();
const deleteMock = vi.fn();

function dashboardRow(overrides?: Record<string, unknown>) {
  return {
    total_audit_events: 120,
    events_today: 8,
    events_last_7_days: 45,
    failed_operations: 3,
    user_activity_count: 4,
    production_events: 20,
    inventory_events: 15,
    sales_events: 30,
    purchase_events: 25,
    last_audit_event_at: "2026-07-25T16:00:00.000Z",
    ...overrides,
  };
}

function mappedDashboard(overrides?: Partial<AuditDashboard>): AuditDashboard {
  return {
    total_audit_events: 120,
    events_today: 8,
    events_last_7_days: 45,
    failed_operations: 3,
    user_activity_count: 4,
    production_events: 20,
    inventory_events: 15,
    sales_events: 30,
    purchase_events: 25,
    last_audit_event_at: "2026-07-25T16:00:00.000Z",
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
    "get_audit_dashboard",
  ]);
  expect(supabaseMock.auth.getUser).not.toHaveBeenCalled();
  expectNoDirectWrites();
}

describe("auditDashboardService.getAuditDashboard (DEV-070)", () => {
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

  it("retrieves audit dashboard successfully via get_audit_dashboard", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow(),
      error: null,
    });

    const result = await auditDashboardService.getAuditDashboard();

    expect(result.error).toBeNull();
    expect(result.data).toEqual(mappedDashboard() satisfies AuditDashboard);
    expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
    expect(supabaseMock.rpc).toHaveBeenCalledWith("get_audit_dashboard");
    expectReadOnly();
  });

  it("maps empty/default dashboard with zero metrics and null last event", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow({
        total_audit_events: 0,
        events_today: 0,
        events_last_7_days: 0,
        failed_operations: 0,
        user_activity_count: 0,
        production_events: 0,
        inventory_events: 0,
        sales_events: 0,
        purchase_events: 0,
        last_audit_event_at: null,
      }),
      error: null,
    });

    const result = await auditDashboardService.getAuditDashboard();

    expect(result.error).toBeNull();
    expect(result.data).toEqual(
      mappedDashboard({
        total_audit_events: 0,
        events_today: 0,
        events_last_7_days: 0,
        failed_operations: 0,
        user_activity_count: 0,
        production_events: 0,
        inventory_events: 0,
        sales_events: 0,
        purchase_events: 0,
        last_audit_event_at: null,
      }) satisfies AuditDashboard,
    );
    expectReadOnly();
  });

  it("maps RPC payload to typed AuditDashboard DTO", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow({
        total_audit_events: 10,
        events_today: 1,
        events_last_7_days: 5,
        failed_operations: 2,
        user_activity_count: 1,
        production_events: 3,
        inventory_events: 4,
        sales_events: 6,
        purchase_events: 7,
        last_audit_event_at: "2026-07-20T08:00:00.000Z",
      }),
      error: null,
    });

    const result = await auditDashboardService.getAuditDashboard();

    expect(result.error).toBeNull();
    expect(result.data).toEqual(
      mappedDashboard({
        total_audit_events: 10,
        events_today: 1,
        events_last_7_days: 5,
        failed_operations: 2,
        user_activity_count: 1,
        production_events: 3,
        inventory_events: 4,
        sales_events: 6,
        purchase_events: 7,
        last_audit_event_at: "2026-07-20T08:00:00.000Z",
      }) satisfies AuditDashboard,
    );
    expectReadOnly();
  });

  it("maps audit metrics from SQL without recalculation", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow({
        total_audit_events: 111,
        events_today: 22,
        events_last_7_days: 33,
        failed_operations: 44,
        user_activity_count: 55,
        production_events: 66,
        inventory_events: 77,
        sales_events: 88,
        purchase_events: 99,
        last_audit_event_at: "2026-06-01T00:00:00.000Z",
      }),
      error: null,
    });

    const result = await auditDashboardService.getAuditDashboard();

    expect(result.error).toBeNull();
    // Values come from the RPC as-is - never recomputed in TypeScript.
    expect(result.data?.total_audit_events).toBe(111);
    expect(result.data?.events_today).toBe(22);
    expect(result.data?.events_last_7_days).toBe(33);
    expect(result.data?.failed_operations).toBe(44);
    expect(result.data?.user_activity_count).toBe(55);
    expect(result.data?.production_events).toBe(66);
    expect(result.data?.inventory_events).toBe(77);
    expect(result.data?.sales_events).toBe(88);
    expect(result.data?.purchase_events).toBe(99);
    expect(result.data?.last_audit_event_at).toBe("2026-06-01T00:00:00.000Z");
    expectReadOnly();
  });

  it("maps missing get_audit_dashboard function errors", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message: "Could not find the function public.get_audit_dashboard",
      },
    });

    const result = await auditDashboardService.getAuditDashboard();

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "Audit dashboard is not available yet. Apply the audit dashboard database script and try again.",
    );
    expectNoDirectWrites();
  });

  it("maps missing audit_dashboard relation errors", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message: 'relation "audit_dashboard" does not exist',
        code: "42P01",
      },
    });

    const result = await auditDashboardService.getAuditDashboard();

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "Audit dashboard is not available yet. Apply the audit dashboard database script and try again.",
    );
    expectNoDirectWrites();
  });

  it("rejects invalid RPC payloads", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [],
      error: null,
    });

    const result = await auditDashboardService.getAuditDashboard();

    expect(result.data).toBeNull();
    expect(result.error).toBe("Audit dashboard response was invalid.");
    expectNoDirectWrites();
  });

  it("rejects negative counts and invalid last event field", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow({ total_audit_events: -1 }),
      error: null,
    });
    const negativeTotal = await auditDashboardService.getAuditDashboard();
    expect(negativeTotal.data).toBeNull();
    expect(negativeTotal.error).toBe("Audit dashboard response was invalid.");

    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow({ failed_operations: -2 }),
      error: null,
    });
    const negativeFailed = await auditDashboardService.getAuditDashboard();
    expect(negativeFailed.data).toBeNull();
    expect(negativeFailed.error).toBe("Audit dashboard response was invalid.");

    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow({ sales_events: -3 }),
      error: null,
    });
    const negativeSales = await auditDashboardService.getAuditDashboard();
    expect(negativeSales.data).toBeNull();
    expect(negativeSales.error).toBe("Audit dashboard response was invalid.");

    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow({ last_audit_event_at: 12345 }),
      error: null,
    });
    const badDate = await auditDashboardService.getAuditDashboard();
    expect(badDate.data).toBeNull();
    expect(badDate.error).toBe("Audit dashboard response was invalid.");

    expectNoDirectWrites();
  });

  it("is read-only and never writes tables", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow(),
      error: null,
    });

    await auditDashboardService.getAuditDashboard();

    expectReadOnly();
  });

  it("never queries audit dashboard source tables directly", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow(),
      error: null,
    });

    await auditDashboardService.getAuditDashboard();

    expect(supabaseMock.from).not.toHaveBeenCalledWith("audit_dashboard");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("audit_log");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("purchases");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("sales");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("production_sessions");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("production_batches");
    expectNoDirectWrites();
  });
});
