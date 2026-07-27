/**
 * Dashboard Completion contracts (DEV-126).
 *
 * Full display composition from Dashboard Read Model projections only.
 * No business recalculation — informational states for missing modules.
 */

import type { LowStockAlert } from "@/features/inventory/types/low-stock-alert";
import type { BusinessHealthModel } from "./business-health";
import type { DashboardKpiCard } from "./dashboard-kpi-cards";
import type { DashboardReadModel } from "./dashboard-read-model";
import type { OperationalDashboardModel } from "./operational-dashboard";

export const DASHBOARD_SNAPSHOT_FIELD_IDS = [
  "daily_revenue",
  "daily_profit",
  "cash_status",
] as const;

export type DashboardSnapshotFieldId =
  (typeof DASHBOARD_SNAPSHOT_FIELD_IDS)[number];

export const DASHBOARD_SNAPSHOT_AVAILABILITIES = [
  "available",
  "empty",
  "missing",
  "not_applicable",
] as const;

export type DashboardSnapshotAvailability =
  (typeof DASHBOARD_SNAPSHOT_AVAILABILITIES)[number];

/** Pre-formatted daily overview field — React renders as-is. */
export interface DashboardSnapshotField {
  id: DashboardSnapshotFieldId;
  label: string;
  display_value: string;
  availability: DashboardSnapshotAvailability;
  detail: string | null;
}

export interface DashboardDailySnapshot {
  fields: DashboardSnapshotField[];
}

/**
 * Complete Dashboard view model for the single business overview page.
 */
export interface DashboardCompletionModel {
  read_model: DashboardReadModel;
  kpi_cards: DashboardKpiCard[];
  operational: OperationalDashboardModel;
  business_health: BusinessHealthModel;
  daily_snapshot: DashboardDailySnapshot;
  /**
   * null = alerts module unavailable.
   * [] = loaded with no alerts.
   */
  low_stock_alerts: LowStockAlert[] | null;
  informational_messages: string[];
}
