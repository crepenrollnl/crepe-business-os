/**
 * System Health domain contracts (DEV-055).
 *
 * Read path: get_system_health RPC over system_health.
 * Status and details come from SQL — never recalculated in TypeScript.
 */

export const SYSTEM_HEALTH_COMPONENTS = [
  "database",
  "company_settings",
  "users",
  "backup",
  "import",
  "export",
] as const;

export type SystemHealthComponent =
  (typeof SYSTEM_HEALTH_COMPONENTS)[number];

export const SYSTEM_HEALTH_STATUSES = [
  "ok",
  "degraded",
  "unavailable",
  "unknown",
] as const;

export type SystemHealthStatus = (typeof SYSTEM_HEALTH_STATUSES)[number];

/**
 * Mapped row from get_system_health for service consumers.
 */
export interface SystemHealth {
  component: SystemHealthComponent;
  status: SystemHealthStatus;
  lastCheckedAt: string;
  details: Record<string, unknown>;
}

export type { ServiceResult } from "@/types/service";
