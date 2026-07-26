/**
 * Audit Dashboard read service (DEV-070).
 *
 * Reads exclusively via get_audit_dashboard RPC.
 * Does NOT mutate data, recalculate metrics, cache, or write tables.
 */

import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import type { AuditDashboard } from "../types/audit-dashboard";

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

function mapAuditDashboard(data: unknown): AuditDashboard {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("Audit dashboard response is invalid.");
  }

  const row = data as Record<string, unknown>;
  const lastAuditEventAt = nullableString(row.last_audit_event_at);

  if (lastAuditEventAt === undefined) {
    throw new Error("Last audit event at is invalid.");
  }

  return {
    total_audit_events: requireNonNegativeInteger(
      row.total_audit_events,
      "Total audit events",
    ),
    events_today: requireNonNegativeInteger(row.events_today, "Events today"),
    events_last_7_days: requireNonNegativeInteger(
      row.events_last_7_days,
      "Events last 7 days",
    ),
    failed_operations: requireNonNegativeInteger(
      row.failed_operations,
      "Failed operations",
    ),
    user_activity_count: requireNonNegativeInteger(
      row.user_activity_count,
      "User activity count",
    ),
    production_events: requireNonNegativeInteger(
      row.production_events,
      "Production events",
    ),
    inventory_events: requireNonNegativeInteger(
      row.inventory_events,
      "Inventory events",
    ),
    sales_events: requireNonNegativeInteger(row.sales_events, "Sales events"),
    purchase_events: requireNonNegativeInteger(
      row.purchase_events,
      "Purchase events",
    ),
    last_audit_event_at: lastAuditEventAt,
  };
}

function mapAuditDashboardRpcError(message: string): string | null {
  const normalized = message.toLowerCase();

  if (
    normalized.includes("could not find the function") ||
    ((normalized.includes("get_audit_dashboard") ||
      normalized.includes("audit_dashboard")) &&
      (normalized.includes("schema cache") ||
        normalized.includes("does not exist") ||
        normalized.includes("42883") ||
        normalized.includes("42p01")))
  ) {
    return "Audit dashboard is not available yet. Apply the audit dashboard database script and try again.";
  }

  return null;
}

function mapReadError(error: unknown, fallback: string): string {
  return toUserError(error, fallback, {
    map: (err) => {
      const message = rpcErrorMessage(err);
      return message ? mapAuditDashboardRpcError(message) : null;
    },
  });
}

export const auditDashboardService = {
  /**
   * Load audit dashboard summary via get_audit_dashboard RPC.
   */
  async getAuditDashboard(): Promise<ServiceResult<AuditDashboard>> {
    try {
      const { data, error } = await supabase.rpc("get_audit_dashboard");

      if (error) {
        return fail(mapReadError(error, "Failed to load audit dashboard"));
      }

      try {
        return ok(mapAuditDashboard(data));
      } catch {
        return fail("Audit dashboard response was invalid.");
      }
    } catch (error) {
      return fail(mapReadError(error, "Failed to load audit dashboard"));
    }
  },
};
