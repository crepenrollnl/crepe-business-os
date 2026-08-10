/**
 * Dashboard resilience helpers (DEV-126.1).
 *
 * UI composition only — classifies load failures and builds empty
 * read-model shells so available sections can still render.
 * Does not call services or recalculate business values.
 */

import type { DashboardReadModel } from "../types/dashboard-read-model";

export type DashboardFailureOwner = "shift" | "inventory" | "dashboard";

export interface ClassifiedDashboardFailure {
  owner: DashboardFailureOwner;
  /** User-facing copy — no technical implementation details. */
  userMessage: string;
}

/**
 * Empty read-model shell used when a module-owned failure should not
 * take down the whole Dashboard overview.
 */
export function createUnavailableModulesReadModel(): DashboardReadModel {
  return {
    current_shift: null,
    latest_closed_shift: null,
    daily_sales_summary: null,
    daily_profit_summary: null,
    cash_reconciliation: null,
    low_stock_alerts: null,
    kpi_summary: null,
  };
}

/**
 * Classify a Dashboard Read Model load failure for UX ownership.
 * Shift/Inventory issues stay module-local; only true dashboard failures
 * become a global page error.
 */
export function classifyDashboardLoadFailure(
  error: string,
): ClassifiedDashboardFailure {
  const normalized = error.trim().toLowerCase();

  if (
    normalized.includes("shift") ||
    normalized.includes("shifts") ||
    normalized.includes("reconcile") ||
    normalized.includes("reconciliation")
  ) {
    return {
      owner: "shift",
      userMessage:
        "Shift information could not be loaded right now. Other dashboard sections may still be available.",
    };
  }

  if (
    normalized.includes("inventory") ||
    normalized.includes("low stock") ||
    normalized.includes("alert") ||
    normalized.includes("ingredient")
  ) {
    return {
      owner: "inventory",
      userMessage:
        "Inventory alerts could not be loaded right now. Other dashboard sections may still be available.",
    };
  }

  return {
    owner: "dashboard",
    userMessage:
      "The dashboard overview could not be loaded right now. Please try again.",
  };
}

/**
 * Deduplicate informational messages while preserving order.
 */
export function dedupeInformationalMessages(
  messages: readonly string[],
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const message of messages) {
    const trimmed = message.trim();
    if (!trimmed) {
      continue;
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(trimmed);
  }

  return result;
}
