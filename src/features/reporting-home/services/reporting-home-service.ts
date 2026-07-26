/**
 * Reporting Home read service (DEV-074).
 *
 * Reads exclusively via get_reporting_home RPC.
 * Does NOT mutate data, recalculate metrics, cache, or write tables.
 * Preserves the SQL JSON structure for nested dashboard metadata.
 */

import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import type { DashboardNavigationItem } from "@/features/dashboard-navigation/types/dashboard-navigation";
import type { ReportingHome } from "../types/reporting-home";

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

function requireNonNegativeInteger(value: unknown, label: string): number {
  const parsed = toNumber(value);
  if (parsed === undefined || !Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label} is invalid.`);
  }
  return parsed;
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

function mapAvailableDashboard(data: unknown): DashboardNavigationItem {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("Available dashboard item is invalid.");
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

function mapReportingHome(data: unknown): ReportingHome {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("Reporting home response is invalid.");
  }

  const row = data as Record<string, unknown>;
  const availableDashboardsRaw = row.available_dashboards;
  const reportingCategoriesRaw = row.reporting_categories;
  const lastGeneratedAt = nullableString(row.last_generated_at);

  if (!Array.isArray(availableDashboardsRaw)) {
    throw new Error("Available dashboards are invalid.");
  }

  if (!Array.isArray(reportingCategoriesRaw)) {
    throw new Error("Reporting categories are invalid.");
  }

  if (lastGeneratedAt === undefined) {
    throw new Error("Last generated at is invalid.");
  }

  const reportingCategories = reportingCategoriesRaw.map((category, index) => {
    if (typeof category !== "string" || category.trim().length === 0) {
      throw new Error(`Reporting category at index ${index} is invalid.`);
    }
    return category;
  });

  return {
    available_dashboards: availableDashboardsRaw.map(mapAvailableDashboard),
    reporting_categories: reportingCategories,
    total_dashboard_count: requireNonNegativeInteger(
      row.total_dashboard_count,
      "Total dashboard count",
    ),
    available_section_count: requireNonNegativeInteger(
      row.available_section_count,
      "Available section count",
    ),
    last_generated_at: lastGeneratedAt,
    application_reporting_version: requireNonEmptyString(
      row.application_reporting_version,
      "Application reporting version",
    ),
  };
}

function mapReportingHomeRpcError(message: string): string | null {
  const normalized = message.toLowerCase();

  if (
    normalized.includes("could not find the function") ||
    ((normalized.includes("get_reporting_home") ||
      normalized.includes("reporting_home")) &&
      (normalized.includes("schema cache") ||
        normalized.includes("does not exist") ||
        normalized.includes("42883") ||
        normalized.includes("42p01")))
  ) {
    return "Reporting home is not available yet. Apply the reporting home database script and try again.";
  }

  return null;
}

function mapReadError(error: unknown, fallback: string): string {
  return toUserError(error, fallback, {
    map: (err) => {
      const message = rpcErrorMessage(err);
      return message ? mapReportingHomeRpcError(message) : null;
    },
  });
}

export const reportingHomeService = {
  /**
   * Load reporting home workspace summary via get_reporting_home RPC.
   */
  async getReportingHome(): Promise<ServiceResult<ReportingHome>> {
    try {
      const { data, error } = await supabase.rpc("get_reporting_home");

      if (error) {
        return fail(mapReadError(error, "Failed to load reporting home"));
      }

      try {
        return ok(mapReportingHome(data));
      } catch {
        return fail("Reporting home response was invalid.");
      }
    } catch (error) {
      return fail(mapReadError(error, "Failed to load reporting home"));
    }
  },
};
