/**
 * Service-level coverage for userActivityDashboardService (DEV-071).
 *
 * Reads must go only through get_user_activity_dashboard RPC.
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

import { userActivityDashboardService } from "./user-activity-dashboard-service";
import type { UserActivityDashboard } from "../types/user-activity-dashboard";

const insertMock = vi.fn();
const updateMock = vi.fn();
const deleteMock = vi.fn();

function dashboardRow(overrides?: Record<string, unknown>) {
  return {
    active_users_today: 3,
    active_users_last_7_days: 8,
    total_user_actions: 40,
    production_actions: 12,
    inventory_actions: 6,
    purchase_actions: 4,
    sales_actions: 10,
    last_user_activity_at: "2026-07-25T16:00:00.000Z",
    most_active_user: "Ada Operator",
    average_actions_per_user: "5.00",
    ...overrides,
  };
}

function mappedDashboard(
  overrides?: Partial<UserActivityDashboard>,
): UserActivityDashboard {
  return {
    active_users_today: 3,
    active_users_last_7_days: 8,
    total_user_actions: 40,
    production_actions: 12,
    inventory_actions: 6,
    purchase_actions: 4,
    sales_actions: 10,
    last_user_activity_at: "2026-07-25T16:00:00.000Z",
    most_active_user: "Ada Operator",
    average_actions_per_user: 5,
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
    "get_user_activity_dashboard",
  ]);
  expect(supabaseMock.auth.getUser).not.toHaveBeenCalled();
  expectNoDirectWrites();
}

describe("userActivityDashboardService.getUserActivityDashboard (DEV-071)", () => {
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

  it("retrieves user activity dashboard successfully via get_user_activity_dashboard", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow(),
      error: null,
    });

    const result =
      await userActivityDashboardService.getUserActivityDashboard();

    expect(result.error).toBeNull();
    expect(result.data).toEqual(
      mappedDashboard() satisfies UserActivityDashboard,
    );
    expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
    expect(supabaseMock.rpc).toHaveBeenCalledWith(
      "get_user_activity_dashboard",
    );
    expectReadOnly();
  });

  it("maps empty/default dashboard with zero metrics and null activity fields", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow({
        active_users_today: 0,
        active_users_last_7_days: 0,
        total_user_actions: 0,
        production_actions: 0,
        inventory_actions: 0,
        purchase_actions: 0,
        sales_actions: 0,
        last_user_activity_at: null,
        most_active_user: null,
        average_actions_per_user: null,
      }),
      error: null,
    });

    const result =
      await userActivityDashboardService.getUserActivityDashboard();

    expect(result.error).toBeNull();
    expect(result.data).toEqual(
      mappedDashboard({
        active_users_today: 0,
        active_users_last_7_days: 0,
        total_user_actions: 0,
        production_actions: 0,
        inventory_actions: 0,
        purchase_actions: 0,
        sales_actions: 0,
        last_user_activity_at: null,
        most_active_user: null,
        average_actions_per_user: null,
      }) satisfies UserActivityDashboard,
    );
    expectReadOnly();
  });

  it("maps RPC payload to typed UserActivityDashboard DTO", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow({
        active_users_today: 1,
        active_users_last_7_days: 2,
        total_user_actions: 9,
        production_actions: 3,
        inventory_actions: 1,
        purchase_actions: 0,
        sales_actions: 5,
        last_user_activity_at: "2026-07-20T08:00:00.000Z",
        most_active_user: "ops@crepe.local",
        average_actions_per_user: "4.50",
      }),
      error: null,
    });

    const result =
      await userActivityDashboardService.getUserActivityDashboard();

    expect(result.error).toBeNull();
    expect(result.data).toEqual(
      mappedDashboard({
        active_users_today: 1,
        active_users_last_7_days: 2,
        total_user_actions: 9,
        production_actions: 3,
        inventory_actions: 1,
        purchase_actions: 0,
        sales_actions: 5,
        last_user_activity_at: "2026-07-20T08:00:00.000Z",
        most_active_user: "ops@crepe.local",
        average_actions_per_user: 4.5,
      }) satisfies UserActivityDashboard,
    );
    expectReadOnly();
  });

  it("maps user activity metrics from SQL without recalculation", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow({
        active_users_today: 11,
        active_users_last_7_days: 22,
        total_user_actions: 33,
        production_actions: 44,
        inventory_actions: 55,
        purchase_actions: 66,
        sales_actions: 77,
        last_user_activity_at: "2026-06-01T00:00:00.000Z",
        most_active_user: "Baker One",
        average_actions_per_user: "12.34",
      }),
      error: null,
    });

    const result =
      await userActivityDashboardService.getUserActivityDashboard();

    expect(result.error).toBeNull();
    // Values come from the RPC as-is - never recomputed in TypeScript.
    expect(result.data?.active_users_today).toBe(11);
    expect(result.data?.active_users_last_7_days).toBe(22);
    expect(result.data?.total_user_actions).toBe(33);
    expect(result.data?.production_actions).toBe(44);
    expect(result.data?.inventory_actions).toBe(55);
    expect(result.data?.purchase_actions).toBe(66);
    expect(result.data?.sales_actions).toBe(77);
    expect(result.data?.last_user_activity_at).toBe(
      "2026-06-01T00:00:00.000Z",
    );
    expect(result.data?.most_active_user).toBe("Baker One");
    expect(result.data?.average_actions_per_user).toBe(12.34);
    expectReadOnly();
  });

  it("maps missing get_user_activity_dashboard function errors", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message:
          "Could not find the function public.get_user_activity_dashboard",
      },
    });

    const result =
      await userActivityDashboardService.getUserActivityDashboard();

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "User activity dashboard is not available yet. Apply the user activity dashboard database script and try again.",
    );
    expectNoDirectWrites();
  });

  it("maps missing user_activity_dashboard relation errors", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message: 'relation "user_activity_dashboard" does not exist',
        code: "42P01",
      },
    });

    const result =
      await userActivityDashboardService.getUserActivityDashboard();

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "User activity dashboard is not available yet. Apply the user activity dashboard database script and try again.",
    );
    expectNoDirectWrites();
  });

  it("rejects invalid RPC payloads", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [],
      error: null,
    });

    const result =
      await userActivityDashboardService.getUserActivityDashboard();

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "User activity dashboard response was invalid.",
    );
    expectNoDirectWrites();
  });

  it("rejects negative counts and invalid metric fields", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow({ active_users_today: -1 }),
      error: null,
    });
    const negativeToday =
      await userActivityDashboardService.getUserActivityDashboard();
    expect(negativeToday.data).toBeNull();
    expect(negativeToday.error).toBe(
      "User activity dashboard response was invalid.",
    );

    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow({ total_user_actions: -2 }),
      error: null,
    });
    const negativeActions =
      await userActivityDashboardService.getUserActivityDashboard();
    expect(negativeActions.data).toBeNull();
    expect(negativeActions.error).toBe(
      "User activity dashboard response was invalid.",
    );

    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow({ average_actions_per_user: "not-a-number" }),
      error: null,
    });
    const badAverage =
      await userActivityDashboardService.getUserActivityDashboard();
    expect(badAverage.data).toBeNull();
    expect(badAverage.error).toBe(
      "User activity dashboard response was invalid.",
    );

    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow({ most_active_user: 123 }),
      error: null,
    });
    const badUser =
      await userActivityDashboardService.getUserActivityDashboard();
    expect(badUser.data).toBeNull();
    expect(badUser.error).toBe(
      "User activity dashboard response was invalid.",
    );

    expectNoDirectWrites();
  });

  it("is read-only and never writes tables", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow(),
      error: null,
    });

    await userActivityDashboardService.getUserActivityDashboard();

    expectReadOnly();
  });

  it("never queries user activity dashboard source tables directly", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: dashboardRow(),
      error: null,
    });

    await userActivityDashboardService.getUserActivityDashboard();

    expect(supabaseMock.from).not.toHaveBeenCalledWith(
      "user_activity_dashboard",
    );
    expect(supabaseMock.from).not.toHaveBeenCalledWith("audit_log");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("audit_dashboard");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("users");
    expectNoDirectWrites();
  });
});
