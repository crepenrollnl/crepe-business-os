/**
 * Application Information read service (DEV-056).
 *
 * Reads exclusively via get_application_info RPC.
 * Does NOT mutate data, recalculate values, cache, or write tables.
 */

import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import type { ApplicationInfo } from "../types/application-info";

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

function mapApplicationInfoRpcResult(data: unknown): ApplicationInfo {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("Application info response is invalid.");
  }

  const row = data as Record<string, unknown>;
  const applicationName = row.application_name;
  const applicationVersion = row.application_version;
  const databaseVersion = row.database_version;
  const buildNumber = row.build_number;
  const environment = row.environment;
  const timezone = row.timezone;
  const generatedAt = row.generated_at;

  if (
    typeof applicationName !== "string" ||
    applicationName.trim().length === 0
  ) {
    throw new Error("Application name is invalid.");
  }

  if (
    typeof applicationVersion !== "string" ||
    applicationVersion.trim().length === 0
  ) {
    throw new Error("Application version is invalid.");
  }

  if (
    typeof databaseVersion !== "string" ||
    databaseVersion.trim().length === 0
  ) {
    throw new Error("Database version is invalid.");
  }

  if (typeof buildNumber !== "string" || buildNumber.trim().length === 0) {
    throw new Error("Build number is invalid.");
  }

  if (typeof environment !== "string" || environment.trim().length === 0) {
    throw new Error("Environment is invalid.");
  }

  if (typeof timezone !== "string" || timezone.trim().length === 0) {
    throw new Error("Timezone is invalid.");
  }

  if (typeof generatedAt !== "string") {
    throw new Error("Generated at is invalid.");
  }

  return {
    applicationName,
    applicationVersion,
    databaseVersion,
    buildNumber,
    environment,
    timezone,
    generatedAt,
  };
}

function mapApplicationInfoRpcError(message: string): string | null {
  const normalized = message.toLowerCase();

  if (
    normalized.includes("could not find the function") ||
    ((normalized.includes("get_application_info") ||
      normalized.includes("application_info")) &&
      (normalized.includes("schema cache") ||
        normalized.includes("does not exist") ||
        normalized.includes("42883") ||
        normalized.includes("42p01")))
  ) {
    return "Application information is not available yet. Apply the application information database script and try again.";
  }

  return null;
}

function mapReadError(error: unknown, fallback: string): string {
  return toUserError(error, fallback, {
    map: (err) => {
      const message = rpcErrorMessage(err);
      return message ? mapApplicationInfoRpcError(message) : null;
    },
  });
}

export const applicationInfoService = {
  /**
   * Load application information via get_application_info RPC.
   */
  async getApplicationInfo(): Promise<ServiceResult<ApplicationInfo>> {
    try {
      const { data, error } = await supabase.rpc("get_application_info");

      if (error) {
        return fail(
          mapReadError(error, "Failed to load application information"),
        );
      }

      try {
        return ok(mapApplicationInfoRpcResult(data));
      } catch {
        return fail("Application information response was invalid.");
      }
    } catch (error) {
      return fail(
        mapReadError(error, "Failed to load application information"),
      );
    }
  },
};
