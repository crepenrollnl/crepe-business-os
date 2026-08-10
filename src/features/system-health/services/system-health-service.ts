/**
 * System Health read service (DEV-055).
 *
 * Reads exclusively via get_system_health RPC.
 * Does NOT mutate data, recalculate health, cache, run monitors, or write tables.
 */

import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import type {
  SystemHealth,
  SystemHealthComponent,
  SystemHealthStatus,
} from "../types/system-health";
import {
  SYSTEM_HEALTH_COMPONENTS,
  SYSTEM_HEALTH_STATUSES,
} from "../types/system-health";

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

function isComponent(value: string): value is SystemHealthComponent {
  return (SYSTEM_HEALTH_COMPONENTS as readonly string[]).includes(value);
}

function isStatus(value: string): value is SystemHealthStatus {
  return (SYSTEM_HEALTH_STATUSES as readonly string[]).includes(value);
}

function mapDetails(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function mapSystemHealthRow(data: unknown): SystemHealth {
  if (typeof data !== "object" || data === null) {
    throw new Error("System health row is invalid.");
  }

  const row = data as Record<string, unknown>;
  const component = row.component;
  const status = row.status;
  const lastCheckedAt = row.last_checked_at;

  if (typeof component !== "string" || !isComponent(component)) {
    throw new Error("System health component is invalid.");
  }

  if (typeof status !== "string" || !isStatus(status)) {
    throw new Error("System health status is invalid.");
  }

  if (typeof lastCheckedAt !== "string") {
    throw new Error("System health last_checked_at is invalid.");
  }

  return {
    component,
    status,
    lastCheckedAt,
    details: mapDetails(row.details),
  };
}

function mapGetSystemHealthResult(data: unknown): SystemHealth[] {
  if (!Array.isArray(data)) {
    throw new Error("System health response is invalid.");
  }

  return data.map(mapSystemHealthRow);
}

function mapSystemHealthRpcError(message: string): string | null {
  const normalized = message.toLowerCase();

  if (
    normalized.includes("could not find the function") ||
    ((normalized.includes("get_system_health") ||
      normalized.includes("system_health")) &&
      (normalized.includes("schema cache") ||
        normalized.includes("does not exist") ||
        normalized.includes("42883") ||
        normalized.includes("42p01")))
  ) {
    return "System health is not available yet. Apply the system health database script and try again.";
  }

  return null;
}

function mapReadError(error: unknown, fallback: string): string {
  return toUserError(error, fallback, {
    map: (err) => {
      const message = rpcErrorMessage(err);
      return message ? mapSystemHealthRpcError(message) : null;
    },
  });
}

export const systemHealthService = {
  /**
   * Load system health rows via get_system_health RPC.
   * Ordered by component ASC in SQL.
   */
  async getSystemHealth(): Promise<ServiceResult<SystemHealth[]>> {
    try {
      const { data, error } = await supabase.rpc("get_system_health");

      if (error) {
        return fail(mapReadError(error, "Failed to load system health"));
      }

      try {
        return ok(mapGetSystemHealthResult(data));
      } catch {
        return fail("System health response was invalid.");
      }
    } catch (error) {
      return fail(mapReadError(error, "Failed to load system health"));
    }
  },
};
