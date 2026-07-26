/**
 * Dashboard Navigation read service (DEV-073).
 *
 * Reads exclusively via get_dashboard_navigation RPC.
 * Does NOT mutate data, recalculate metrics, cache, or write tables.
 * Preserves the SQL JSON catalog structure.
 */

import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import type {
  DashboardNavigationCatalog,
  DashboardNavigationItem,
} from "../types/dashboard-navigation";

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

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function mapDashboardNavigationItem(data: unknown): DashboardNavigationItem {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("Dashboard navigation item is invalid.");
  }

  const row = data as Record<string, unknown>;
  const sortOrder = toNumber(row.sort_order);

  if (sortOrder === undefined || !Number.isInteger(sortOrder)) {
    throw new Error("Sort order is invalid.");
  }

  return {
    dashboard_key: requireNonEmptyString(row.dashboard_key, "Dashboard key"),
    display_name: requireNonEmptyString(row.display_name, "Display name"),
    category: requireNonEmptyString(row.category, "Category"),
    description: requireNonEmptyString(row.description, "Description"),
    sort_order: sortOrder,
    icon_identifier: requireNonEmptyString(
      row.icon_identifier,
      "Icon identifier",
    ),
    availability: requireNonEmptyString(row.availability, "Availability"),
  };
}

function mapDashboardNavigationCatalog(
  data: unknown,
): DashboardNavigationCatalog {
  if (!Array.isArray(data)) {
    throw new Error("Dashboard navigation response is invalid.");
  }

  return data.map(mapDashboardNavigationItem);
}

function mapDashboardNavigationRpcError(message: string): string | null {
  const normalized = message.toLowerCase();

  if (
    normalized.includes("could not find the function") ||
    ((normalized.includes("get_dashboard_navigation") ||
      normalized.includes("dashboard_navigation")) &&
      (normalized.includes("schema cache") ||
        normalized.includes("does not exist") ||
        normalized.includes("42883") ||
        normalized.includes("42p01")))
  ) {
    return "Dashboard navigation is not available yet. Apply the dashboard navigation database script and try again.";
  }

  return null;
}

function mapReadError(error: unknown, fallback: string): string {
  return toUserError(error, fallback, {
    map: (err) => {
      const message = rpcErrorMessage(err);
      return message ? mapDashboardNavigationRpcError(message) : null;
    },
  });
}

export const dashboardNavigationService = {
  /**
   * Load dashboard navigation catalog via get_dashboard_navigation RPC.
   * Ordered by sort_order ASC in SQL.
   */
  async getDashboardNavigation(): Promise<
    ServiceResult<DashboardNavigationCatalog>
  > {
    try {
      const { data, error } = await supabase.rpc("get_dashboard_navigation");

      if (error) {
        return fail(mapReadError(error, "Failed to load dashboard navigation"));
      }

      try {
        return ok(mapDashboardNavigationCatalog(data));
      } catch {
        return fail("Dashboard navigation response was invalid.");
      }
    } catch (error) {
      return fail(mapReadError(error, "Failed to load dashboard navigation"));
    }
  },
};
