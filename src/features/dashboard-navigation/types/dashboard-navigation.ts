/**
 * Dashboard Navigation domain contracts (DEV-073).
 *
 * Read path: get_dashboard_navigation RPC over dashboard_navigation.
 * Values come from SQL - never recalculated in TypeScript.
 */

/**
 * Mapped row from get_dashboard_navigation for service consumers.
 * Field names match the SQL JSON payload.
 */
export interface DashboardNavigationItem {
  dashboard_key: string;
  display_name: string;
  category: string;
  description: string;
  sort_order: number;
  icon_identifier: string;
  availability: string;
}

/**
 * Catalog payload from get_dashboard_navigation.
 * Preserves the SQL JSON array structure.
 */
export type DashboardNavigationCatalog = DashboardNavigationItem[];

export type { ServiceResult } from "@/types/service";
