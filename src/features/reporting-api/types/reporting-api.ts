/**
 * Reporting API domain contracts (DEV-072).
 *
 * Read path: get_reporting_overview / get_reporting_section RPCs over
 * reporting_api / reporting_api_sections.
 * Nested dashboard payloads preserve SQL JSON structure - never recalculated
 * in TypeScript.
 */

import type { AlertsDashboard } from "@/features/alerts-dashboard/types/alerts-dashboard";
import type { AuditDashboard } from "@/features/audit-dashboard/types/audit-dashboard";
import type { CompanyDashboard } from "@/features/company-dashboard/types/company-dashboard";
import type { ExecutiveDashboard } from "@/features/executive-dashboard/types/executive-dashboard";
import type { InventoryDashboard } from "@/features/inventory-dashboard/types/inventory-dashboard";
import type { KpiDashboard } from "@/features/kpi-dashboard/types/kpi-dashboard";
import type { ProductionDashboard } from "@/features/production-dashboard/types/production-dashboard";
import type { UserActivityDashboard } from "@/features/user-activity-dashboard/types/user-activity-dashboard";

export type ReportingSectionName =
  | "executive"
  | "kpi"
  | "company"
  | "inventory"
  | "production"
  | "audit"
  | "user_activity"
  | "alerts";

/**
 * Catalog entry from reporting_api.sections / reporting_api_sections.
 */
export interface ReportingSectionCatalogItem {
  section_name: ReportingSectionName;
  title: string;
  source_view: string;
  source_rpc: string;
}

/**
 * Mapped overview from get_reporting_overview.
 */
export interface ReportingOverview {
  generated_at: string;
  sections: ReportingSectionCatalogItem[];
  executive: ExecutiveDashboard;
  kpi: KpiDashboard;
  company: CompanyDashboard;
  inventory: InventoryDashboard;
  production: ProductionDashboard;
  audit: AuditDashboard;
  user_activity: UserActivityDashboard;
  alerts: AlertsDashboard;
}

export type { ServiceResult } from "@/types/service";
