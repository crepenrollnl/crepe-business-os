/**
 * License & Application Information domain contracts (DEV-056).
 *
 * Read path: get_application_info RPC over application_info.
 * Values come from SQL - never recalculated in TypeScript.
 */

/**
 * Mapped row from get_application_info for service consumers.
 */
export interface ApplicationInfo {
  applicationName: string;
  applicationVersion: string;
  databaseVersion: string;
  buildNumber: string;
  environment: string;
  timezone: string;
  generatedAt: string;
}

export type { ServiceResult } from "@/types/service";
