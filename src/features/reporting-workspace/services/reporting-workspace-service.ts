/**
 * Reporting Workspace read service (DEV-075).
 *
 * Reads exclusively via get_reporting_workspace RPC.
 * Does NOT mutate data, recalculate metrics, cache, or write tables.
 * Nested payloads preserve SQL JSON structure and reuse existing DTOs.
 */

import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import type {
  DashboardNavigationCatalog,
  DashboardNavigationItem,
} from "@/features/dashboard-navigation/types/dashboard-navigation";
import type {
  ReportingOverview,
  ReportingSectionCatalogItem,
  ReportingSectionName,
} from "@/features/reporting-api/types/reporting-api";
import type { ReportingWorkspace } from "../types/reporting-workspace";

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

function requireObject(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value as Record<string, unknown>;
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
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

function parseSectionName(value: unknown): ReportingSectionName | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "executive" ||
    normalized === "kpi" ||
    normalized === "company" ||
    normalized === "inventory" ||
    normalized === "production" ||
    normalized === "audit" ||
    normalized === "user_activity" ||
    normalized === "alerts"
  ) {
    return normalized;
  }
  return undefined;
}

function mapNavigationItem(data: unknown): DashboardNavigationItem {
  const row = requireObject(data, "Navigation item");
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

function mapNavigationCatalog(data: unknown): DashboardNavigationCatalog {
  if (!Array.isArray(data)) {
    throw new Error("Navigation catalog is invalid.");
  }
  return data.map(mapNavigationItem);
}

function mapSectionCatalogItem(data: unknown): ReportingSectionCatalogItem {
  const row = requireObject(data, "Reporting section catalog item");
  const sectionName = parseSectionName(row.section_name);
  const title = row.title;
  const sourceView = row.source_view;
  const sourceRpc = row.source_rpc;

  if (sectionName === undefined) {
    throw new Error("Section name is invalid.");
  }

  if (typeof title !== "string" || title.trim().length === 0) {
    throw new Error("Section title is invalid.");
  }

  if (typeof sourceView !== "string" || sourceView.trim().length === 0) {
    throw new Error("Source view is invalid.");
  }

  if (typeof sourceRpc !== "string" || sourceRpc.trim().length === 0) {
    throw new Error("Source RPC is invalid.");
  }

  return {
    section_name: sectionName,
    title,
    source_view: sourceView,
    source_rpc: sourceRpc,
  };
}

function mapDashboardPayload<T>(data: unknown, label: string): T {
  return requireObject(data, label) as T;
}

function mapReportingOverview(data: unknown): ReportingOverview {
  const row = requireObject(data, "Reporting overview");
  const generatedAt = row.generated_at;
  const sectionsRaw = row.sections;

  if (typeof generatedAt !== "string") {
    throw new Error("Generated at is invalid.");
  }

  if (!Array.isArray(sectionsRaw)) {
    throw new Error("Reporting sections are invalid.");
  }

  return {
    generated_at: generatedAt,
    sections: sectionsRaw.map(mapSectionCatalogItem),
    executive: mapDashboardPayload(row.executive, "Executive section"),
    kpi: mapDashboardPayload(row.kpi, "KPI section"),
    company: mapDashboardPayload(row.company, "Company section"),
    inventory: mapDashboardPayload(row.inventory, "Inventory section"),
    production: mapDashboardPayload(row.production, "Production section"),
    audit: mapDashboardPayload(row.audit, "Audit section"),
    user_activity: mapDashboardPayload(
      row.user_activity,
      "User activity section",
    ),
    alerts: mapDashboardPayload(row.alerts, "Alerts section"),
  };
}

function mapReportingWorkspace(data: unknown): ReportingWorkspace {
  const row = requireObject(data, "Reporting workspace response");
  const generatedAt = nullableString(row.generated_at);
  const overviewRaw = row.reporting_overview;

  if (generatedAt === undefined) {
    throw new Error("Generated at is invalid.");
  }

  let reportingOverview: ReportingOverview | null = null;
  if (overviewRaw !== null) {
    reportingOverview = mapReportingOverview(overviewRaw);
  }

  return {
    workspace_title: requireNonEmptyString(
      row.workspace_title,
      "Workspace title",
    ),
    reporting_version: requireNonEmptyString(
      row.reporting_version,
      "Reporting version",
    ),
    available_dashboards: mapNavigationCatalog(row.available_dashboards),
    navigation_catalog: mapNavigationCatalog(row.navigation_catalog),
    reporting_overview: reportingOverview,
    generated_at: generatedAt,
  };
}

function mapReportingWorkspaceRpcError(message: string): string | null {
  const normalized = message.toLowerCase();

  if (
    normalized.includes("could not find the function") ||
    ((normalized.includes("get_reporting_workspace") ||
      normalized.includes("reporting_workspace")) &&
      (normalized.includes("schema cache") ||
        normalized.includes("does not exist") ||
        normalized.includes("42883") ||
        normalized.includes("42p01")))
  ) {
    return "Reporting workspace is not available yet. Apply the reporting workspace database script and try again.";
  }

  return null;
}

function mapReadError(error: unknown, fallback: string): string {
  return toUserError(error, fallback, {
    map: (err) => {
      const message = rpcErrorMessage(err);
      return message ? mapReportingWorkspaceRpcError(message) : null;
    },
  });
}

export const reportingWorkspaceService = {
  /**
   * Load reporting workspace aggregate via get_reporting_workspace RPC.
   */
  async getReportingWorkspace(): Promise<ServiceResult<ReportingWorkspace>> {
    try {
      const { data, error } = await supabase.rpc("get_reporting_workspace");

      if (error) {
        return fail(mapReadError(error, "Failed to load reporting workspace"));
      }

      try {
        return ok(mapReportingWorkspace(data));
      } catch {
        return fail("Reporting workspace response was invalid.");
      }
    } catch (error) {
      return fail(mapReadError(error, "Failed to load reporting workspace"));
    }
  },
};
