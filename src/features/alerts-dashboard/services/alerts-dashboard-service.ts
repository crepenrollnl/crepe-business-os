/**
 * Alerts Dashboard read service (DEV-069).
 *
 * Reads exclusively via get_alerts_dashboard RPC.
 * Does NOT mutate data, recalculate metrics, cache, or write tables.
 */

import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import type { AlertsDashboard } from "../types/alerts-dashboard";

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

function requireNonNegativeInteger(value: unknown, label: string): number {
  const parsed = toNumber(value);
  if (parsed === undefined || !Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label} is invalid.`);
  }
  return parsed;
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  throw new Error(`${label} is invalid.`);
}

function mapAlertsDashboard(data: unknown): AlertsDashboard {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("Alerts dashboard response is invalid.");
  }

  const row = data as Record<string, unknown>;
  const backupStatus = row.backup_status;

  if (typeof backupStatus !== "string" || backupStatus.trim().length === 0) {
    throw new Error("Backup status is invalid.");
  }

  return {
    low_stock_alerts: requireNonNegativeInteger(
      row.low_stock_alerts,
      "Low stock alerts",
    ),
    out_of_stock_alerts: requireNonNegativeInteger(
      row.out_of_stock_alerts,
      "Out of stock alerts",
    ),
    overdue_production: requireNonNegativeInteger(
      row.overdue_production,
      "Overdue production",
    ),
    failed_batches: requireNonNegativeInteger(
      row.failed_batches,
      "Failed batches",
    ),
    stale_purchase_prices: requireNonNegativeInteger(
      row.stale_purchase_prices,
      "Stale purchase prices",
    ),
    inactive_suppliers: requireNonNegativeInteger(
      row.inactive_suppliers,
      "Inactive suppliers",
    ),
    declining_sales: requireBoolean(row.declining_sales, "Declining sales"),
    missing_company_settings: requireBoolean(
      row.missing_company_settings,
      "Missing company settings",
    ),
    backup_status: backupStatus,
    import_export_failures: requireNonNegativeInteger(
      row.import_export_failures,
      "Import export failures",
    ),
  };
}

function mapAlertsDashboardRpcError(message: string): string | null {
  const normalized = message.toLowerCase();

  if (
    normalized.includes("could not find the function") ||
    ((normalized.includes("get_alerts_dashboard") ||
      normalized.includes("alerts_dashboard")) &&
      (normalized.includes("schema cache") ||
        normalized.includes("does not exist") ||
        normalized.includes("42883") ||
        normalized.includes("42p01")))
  ) {
    return "Alerts dashboard is not available yet. Apply the alerts dashboard database script and try again.";
  }

  return null;
}

function mapReadError(error: unknown, fallback: string): string {
  return toUserError(error, fallback, {
    map: (err) => {
      const message = rpcErrorMessage(err);
      return message ? mapAlertsDashboardRpcError(message) : null;
    },
  });
}

export const alertsDashboardService = {
  /**
   * Load alerts dashboard summary via get_alerts_dashboard RPC.
   */
  async getAlertsDashboard(): Promise<ServiceResult<AlertsDashboard>> {
    try {
      const { data, error } = await supabase.rpc("get_alerts_dashboard");

      if (error) {
        return fail(mapReadError(error, "Failed to load alerts dashboard"));
      }

      try {
        return ok(mapAlertsDashboard(data));
      } catch {
        return fail("Alerts dashboard response was invalid.");
      }
    } catch (error) {
      return fail(mapReadError(error, "Failed to load alerts dashboard"));
    }
  },
};
