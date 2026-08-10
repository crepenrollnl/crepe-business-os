/**
 * Reporting Workspace domain contracts (DEV-075).
 *
 * Read path: get_reporting_workspace RPC over reporting_workspace.
 * Values come from SQL - never recalculated in TypeScript.
 * Nested payloads reuse existing reporting DTOs.
 */

import type {
  DashboardNavigationCatalog,
  DashboardNavigationItem,
} from "@/features/dashboard-navigation/types/dashboard-navigation";
import type { ReportingOverview } from "@/features/reporting-api/types/reporting-api";

/**
 * Mapped row from get_reporting_workspace for service consumers.
 * Field names match the SQL JSON payload.
 */
export interface ReportingWorkspace {
  workspace_title: string;
  reporting_version: string;
  available_dashboards: DashboardNavigationItem[];
  navigation_catalog: DashboardNavigationCatalog;
  reporting_overview: ReportingOverview | null;
  generated_at: string | null;
}

export type { ServiceResult } from "@/types/service";
