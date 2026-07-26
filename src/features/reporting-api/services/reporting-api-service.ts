/**
 * Reporting API read service (DEV-072).
 *
 * Reads exclusively via get_reporting_overview and get_reporting_section RPCs.
 * Does NOT mutate data, recalculate metrics, cache, or write tables.
 * Nested dashboard payloads preserve SQL JSON structure.
 */

import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import type {
  ReportingOverview,
  ReportingSection,
  ReportingSectionCatalogItem,
  ReportingSectionName,
} from "../types/reporting-api";

const SECTION_NAMES = new Set<ReportingSectionName>([
  "executive",
  "kpi",
  "company",
  "inventory",
  "production",
  "audit",
  "user_activity",
  "alerts",
]);

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

function requireObject(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value as Record<string, unknown>;
}

function mapCatalogItem(data: unknown): ReportingSectionCatalogItem {
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
  const row = requireObject(data, "Reporting overview response");
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
    sections: sectionsRaw.map(mapCatalogItem),
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

function mapReportingSection(data: unknown): ReportingSection {
  const row = requireObject(data, "Reporting section response");
  const sectionName = parseSectionName(row.section_name);
  const title = row.title;
  const sourceView = row.source_view;
  const sourceRpc = row.source_rpc;
  const sectionData = requireObject(row.data, "Reporting section data");

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
    data: sectionData as ReportingSection["data"],
  };
}

function mapReportingApiRpcError(message: string): string | null {
  const normalized = message.toLowerCase();

  if (normalized.includes("section name is required")) {
    return "Section name is required.";
  }

  if (normalized.includes("unknown reporting section")) {
    return "Unknown reporting section. Use executive, kpi, company, inventory, production, audit, user_activity, or alerts.";
  }

  if (
    normalized.includes("could not find the function") ||
    ((normalized.includes("get_reporting_overview") ||
      normalized.includes("get_reporting_section") ||
      normalized.includes("reporting_api")) &&
      (normalized.includes("schema cache") ||
        normalized.includes("does not exist") ||
        normalized.includes("42883") ||
        normalized.includes("42p01")))
  ) {
    return "Reporting API is not available yet. Apply the reporting API database script and try again.";
  }

  return null;
}

function mapReadError(error: unknown, fallback: string): string {
  return toUserError(error, fallback, {
    map: (err) => {
      const message = rpcErrorMessage(err);
      return message ? mapReportingApiRpcError(message) : null;
    },
  });
}

export const reportingApiService = {
  /**
   * Load reporting overview via get_reporting_overview RPC.
   */
  async getReportingOverview(): Promise<ServiceResult<ReportingOverview>> {
    try {
      const { data, error } = await supabase.rpc("get_reporting_overview");

      if (error) {
        return fail(mapReadError(error, "Failed to load reporting overview"));
      }

      try {
        return ok(mapReportingOverview(data));
      } catch {
        return fail("Reporting overview response was invalid.");
      }
    } catch (error) {
      return fail(mapReadError(error, "Failed to load reporting overview"));
    }
  },

  /**
   * Load one reporting section via get_reporting_section RPC.
   */
  async getReportingSection(
    sectionName: ReportingSectionName | string,
  ): Promise<ServiceResult<ReportingSection>> {
    try {
      const normalized = parseSectionName(sectionName);
      if (normalized === undefined || !SECTION_NAMES.has(normalized)) {
        return fail(
          "Unknown reporting section. Use executive, kpi, company, inventory, production, audit, user_activity, or alerts.",
        );
      }

      const { data, error } = await supabase.rpc("get_reporting_section", {
        p_section_name: normalized,
      });

      if (error) {
        return fail(mapReadError(error, "Failed to load reporting section"));
      }

      try {
        return ok(mapReportingSection(data));
      } catch {
        return fail("Reporting section response was invalid.");
      }
    } catch (error) {
      return fail(mapReadError(error, "Failed to load reporting section"));
    }
  },
};
