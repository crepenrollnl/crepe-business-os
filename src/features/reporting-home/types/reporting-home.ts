/**
 * Reporting Home domain contracts (DEV-074).
 *
 * Read path: get_reporting_home RPC over reporting_home.
 * Values come from SQL - never recalculated in TypeScript.
 * Nested dashboard entries preserve SQL JSON structure.
 */

import type { DashboardNavigationItem } from "@/features/dashboard-navigation/types/dashboard-navigation";

/**
 * Mapped row from get_reporting_home for service consumers.
 * Field names match the SQL JSON payload.
 */
export interface ReportingHome {
  available_dashboards: DashboardNavigationItem[];
  reporting_categories: string[];
  total_dashboard_count: number;
  available_section_count: number;
  last_generated_at: string | null;
  application_reporting_version: string;
}

export type { ServiceResult } from "@/types/service";
