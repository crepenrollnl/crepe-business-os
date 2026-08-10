/**
 * Service-level coverage for systemHealthService (DEV-055).
 *
 * Reads must go only through get_system_health RPC.
 * The service must not query tables directly, recalculate health, cache,
 * run monitors, or write data.
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

import { systemHealthService } from "./system-health-service";
import type { SystemHealth } from "../types/system-health";
import {
  SYSTEM_HEALTH_COMPONENTS,
  SYSTEM_HEALTH_STATUSES,
} from "../types/system-health";

const BACKUP_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const insertMock = vi.fn();
const updateMock = vi.fn();
const deleteMock = vi.fn();

function healthRow(overrides?: Record<string, unknown>) {
  return {
    component: "database",
    status: "ok",
    last_checked_at: "2026-07-25T16:00:00.000Z",
    details: {
      database_name: "postgres",
    },
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
    "get_system_health",
  ]);
  expect(supabaseMock.auth.getUser).not.toHaveBeenCalled();
  expectNoDirectWrites();
}

describe("systemHealthService.getSystemHealth (DEV-055)", () => {
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

  it("retrieves health successfully via get_system_health", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [
        healthRow({
          component: "backup",
          status: "degraded",
          last_checked_at: "2026-07-25T15:00:00.000Z",
          details: {
            latest_status: "failed",
            latest_id: BACKUP_ID,
            total_count: 3,
          },
        }),
        healthRow(),
      ],
      error: null,
    });

    const result = await systemHealthService.getSystemHealth();

    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(2);
    expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
    expect(supabaseMock.rpc).toHaveBeenCalledWith("get_system_health");
    expectReadOnly();
  });

  it("returns an empty array when health list is empty", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [],
      error: null,
    });

    const result = await systemHealthService.getSystemHealth();

    expect(result.error).toBeNull();
    expect(result.data).toEqual([] satisfies SystemHealth[]);
    expectReadOnly();
  });

  it("maps RPC rows to typed SystemHealth DTOs with details passthrough", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [
        healthRow({
          component: "company_settings",
          status: "unavailable",
          last_checked_at: "2026-07-25T16:30:00.000Z",
          details: {
            configured: false,
            company_name: null,
            nested: { ok: true },
          },
        }),
      ],
      error: null,
    });

    const result = await systemHealthService.getSystemHealth();

    expect(result.error).toBeNull();
    expect(result.data).toEqual([
      {
        component: "company_settings",
        status: "unavailable",
        lastCheckedAt: "2026-07-25T16:30:00.000Z",
        details: {
          configured: false,
          company_name: null,
          nested: { ok: true },
        },
      },
    ] satisfies SystemHealth[]);
    expectReadOnly();
  });

  it("maps every known component enum value", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: SYSTEM_HEALTH_COMPONENTS.map((component) =>
        healthRow({
          component,
          details: { component },
        }),
      ),
      error: null,
    });

    const result = await systemHealthService.getSystemHealth();

    expect(result.error).toBeNull();
    expect(result.data?.map((row) => row.component)).toEqual([
      ...SYSTEM_HEALTH_COMPONENTS,
    ]);
    expectReadOnly();
  });

  it("maps every known status enum value", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: SYSTEM_HEALTH_STATUSES.map((status, index) =>
        healthRow({
          component: SYSTEM_HEALTH_COMPONENTS[index] ?? "database",
          status,
          details: { status },
        }),
      ),
      error: null,
    });

    const result = await systemHealthService.getSystemHealth();

    expect(result.error).toBeNull();
    expect(result.data?.map((row) => row.status)).toEqual([
      ...SYSTEM_HEALTH_STATUSES,
    ]);
    expectReadOnly();
  });

  it("maps missing get_system_health function errors", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message: "Could not find the function public.get_system_health",
      },
    });

    const result = await systemHealthService.getSystemHealth();

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "System health is not available yet. Apply the system health database script and try again.",
    );
    expectNoDirectWrites();
  });

  it("maps missing system_health relation errors", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message: 'relation "system_health" does not exist',
        code: "42P01",
      },
    });

    const result = await systemHealthService.getSystemHealth();

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "System health is not available yet. Apply the system health database script and try again.",
    );
    expectNoDirectWrites();
  });

  it("is read-only and never writes tables", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [healthRow()],
      error: null,
    });

    await systemHealthService.getSystemHealth();

    expectReadOnly();
  });

  it("rejects invalid component enum values", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [healthRow({ component: "payments" })],
      error: null,
    });

    const result = await systemHealthService.getSystemHealth();

    expect(result.data).toBeNull();
    expect(result.error).toBe("System health response was invalid.");
    expectNoDirectWrites();
  });

  it("rejects invalid status enum values", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [healthRow({ status: "critical" })],
      error: null,
    });

    const result = await systemHealthService.getSystemHealth();

    expect(result.data).toBeNull();
    expect(result.error).toBe("System health response was invalid.");
    expectNoDirectWrites();
  });

  it("rejects invalid RPC payloads", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: { not: "an-array" },
      error: null,
    });

    const result = await systemHealthService.getSystemHealth();

    expect(result.data).toBeNull();
    expect(result.error).toBe("System health response was invalid.");
    expectNoDirectWrites();
  });

  it("never queries system_health or other tables directly", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [healthRow()],
      error: null,
    });

    await systemHealthService.getSystemHealth();

    expect(supabaseMock.from).not.toHaveBeenCalledWith("system_health");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("backup_history");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("import_jobs");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("export_jobs");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("company_settings");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("users");
    expectNoDirectWrites();
  });

  it("passes details through without recalculation", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [
        healthRow({
          component: "users",
          status: "unknown",
          details: {
            user_count: 0,
            active_user_count: 0,
            role_count: 2,
          },
        }),
      ],
      error: null,
    });

    const result = await systemHealthService.getSystemHealth();

    expect(result.error).toBeNull();
    expect(result.data?.[0]?.details).toEqual({
      user_count: 0,
      active_user_count: 0,
      role_count: 2,
    });
    expectReadOnly();
  });
});
