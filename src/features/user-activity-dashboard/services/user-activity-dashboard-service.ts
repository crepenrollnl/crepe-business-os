/**
 * User Activity Dashboard read service (DEV-071).
 *
 * Reads exclusively via get_user_activity_dashboard RPC.
 * Does NOT mutate data, recalculate metrics, cache, or write tables.
 */

import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import type { UserActivityDashboard } from "../types/user-activity-dashboard";

function rpcErrorMessage(error: unknown): string | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }

  return typeof error === "string" ? error : null;
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function nullableNumber(value: unknown): number | null | undefined {
  if (value === null) {
    return null;
  }
  return toNumber(value);
}

function nullableString(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  return undefined;
}

function requireNonNegativeInteger(value: unknown, label: string): number {
  const parsed = toNumber(value);
  if (parsed === undefined || !Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label} is invalid.`);
  }
  return parsed;
}

function mapUserActivityDashboard(data: unknown): UserActivityDashboard {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("User activity dashboard response is invalid.");
  }

  const row = data as Record<string, unknown>;
  const lastUserActivityAt = nullableString(row.last_user_activity_at);
  const mostActiveUser = nullableString(row.most_active_user);
  const averageActionsPerUser = nullableNumber(row.average_actions_per_user);

  if (lastUserActivityAt === undefined) {
    throw new Error("Last user activity at is invalid.");
  }

  if (mostActiveUser === undefined) {
    throw new Error("Most active user is invalid.");
  }

  if (averageActionsPerUser === undefined) {
    throw new Error("Average actions per user is invalid.");
  }

  return {
    active_users_today: requireNonNegativeInteger(
      row.active_users_today,
      "Active users today",
    ),
    active_users_last_7_days: requireNonNegativeInteger(
      row.active_users_last_7_days,
      "Active users last 7 days",
    ),
    total_user_actions: requireNonNegativeInteger(
      row.total_user_actions,
      "Total user actions",
    ),
    production_actions: requireNonNegativeInteger(
      row.production_actions,
      "Production actions",
    ),
    inventory_actions: requireNonNegativeInteger(
      row.inventory_actions,
      "Inventory actions",
    ),
    purchase_actions: requireNonNegativeInteger(
      row.purchase_actions,
      "Purchase actions",
    ),
    sales_actions: requireNonNegativeInteger(
      row.sales_actions,
      "Sales actions",
    ),
    last_user_activity_at: lastUserActivityAt,
    most_active_user: mostActiveUser,
    average_actions_per_user: averageActionsPerUser,
  };
}

function mapUserActivityDashboardRpcError(message: string): string | null {
  const normalized = message.toLowerCase();

  if (
    normalized.includes("could not find the function") ||
    ((normalized.includes("get_user_activity_dashboard") ||
      normalized.includes("user_activity_dashboard")) &&
      (normalized.includes("schema cache") ||
        normalized.includes("does not exist") ||
        normalized.includes("42883") ||
        normalized.includes("42p01")))
  ) {
    return "User activity dashboard is not available yet. Apply the user activity dashboard database script and try again.";
  }

  return null;
}

function mapReadError(error: unknown, fallback: string): string {
  return toUserError(error, fallback, {
    map: (err) => {
      const message = rpcErrorMessage(err);
      return message ? mapUserActivityDashboardRpcError(message) : null;
    },
  });
}

export const userActivityDashboardService = {
  /**
   * Load user activity dashboard summary via get_user_activity_dashboard RPC.
   */
  async getUserActivityDashboard(): Promise<
    ServiceResult<UserActivityDashboard>
  > {
    try {
      const { data, error } = await supabase.rpc(
        "get_user_activity_dashboard",
      );

      if (error) {
        return fail(
          mapReadError(error, "Failed to load user activity dashboard"),
        );
      }

      try {
        return ok(mapUserActivityDashboard(data));
      } catch {
        return fail("User activity dashboard response was invalid.");
      }
    } catch (error) {
      return fail(
        mapReadError(error, "Failed to load user activity dashboard"),
      );
    }
  },
};
