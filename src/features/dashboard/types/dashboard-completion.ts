/**
 * Dashboard Completion contracts (Dashboard redesign — 3 blocks).
 *
 * Full display composition from Dashboard Read Model projections only.
 * No business recalculation — informational states for missing modules.
 */

import type { LowStockAlert } from "@/features/inventory/types/low-stock-alert";
import type { DashboardReadModel } from "./dashboard-read-model";

export const MONEY_TODAY_FIELD_AVAILABILITIES = ["available", "missing"] as const;

export type MoneyTodayFieldAvailability =
  (typeof MONEY_TODAY_FIELD_AVAILABILITIES)[number];

/** Pre-formatted Money Today field — React renders as-is. */
export interface MoneyTodayField {
  id: string;
  label: string;
  display_value: string;
  availability: MoneyTodayFieldAvailability;
}

export const MONEY_TODAY_SOURCES = [
  "closed_shift_summary",
  "pending",
  "unavailable",
] as const;

export type MoneyTodaySource = (typeof MONEY_TODAY_SOURCES)[number];

/**
 * Block 2 ("Money Today") of the redesigned dashboard.
 * Consolidates what used to be duplicated across Today's Summary, Key
 * Indicators, and the Shift Details Close Day Review revenue/profit grids.
 */
export interface MoneyTodayModel {
  source: MoneyTodaySource;
  /** Human-readable provenance shown under the block title. */
  source_label: string;
  revenue: MoneyTodayField;
  profit: MoneyTodayField;
  /** Sales count, Items sold, Net revenue, Total COGS, Gross Margin %. */
  details: MoneyTodayField[];
}

/**
 * Complete Dashboard view model for the single business overview page.
 */
export interface DashboardCompletionModel {
  read_model: DashboardReadModel;
  money_today: MoneyTodayModel;
  /**
   * null = alerts module unavailable.
   * [] = loaded with no alerts.
   */
  low_stock_alerts: LowStockAlert[] | null;
  informational_messages: string[];
}
