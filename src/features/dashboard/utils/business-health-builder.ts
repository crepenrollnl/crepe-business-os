/**
 * Business Health pure builder (DEV-125).
 *
 * Combines existing Dashboard Read Model statuses into an informational summary.
 * No financial calculations. No inventory quantity/days calculations.
 */

import type { DashboardReadModel } from "../types/dashboard-read-model";
import type {
  BuildBusinessHealthInput,
  BusinessHealthIndicator,
  BusinessHealthLevel,
  BusinessHealthModel,
} from "../types/business-health";

const LEVEL_RANK: Record<BusinessHealthLevel, number> = {
  healthy: 0,
  attention: 1,
  critical: 2,
};

function worseLevel(
  a: BusinessHealthLevel,
  b: BusinessHealthLevel,
): BusinessHealthLevel {
  return LEVEL_RANK[a] >= LEVEL_RANK[b] ? a : b;
}

function formatOverallDisplay(level: BusinessHealthLevel): string {
  if (level === "critical") {
    return "Critical";
  }
  if (level === "attention") {
    return "Attention";
  }
  return "Healthy";
}

function buildShiftIndicator(
  input: BuildBusinessHealthInput,
): BusinessHealthIndicator {
  if (input.current_shift) {
    return {
      id: "shift_status",
      label: "Shift Status",
      display_value: "Open",
      level: "healthy",
      detail: "An open shift is in progress.",
    };
  }

  if (input.latest_closed_shift) {
    return {
      id: "shift_status",
      label: "Shift Status",
      display_value: "Closed",
      level: "healthy",
      detail: "Latest shift is closed.",
    };
  }

  return {
    id: "shift_status",
    label: "Shift Status",
    display_value: "None",
    level: "attention",
    detail: "No active or closed shift is available.",
  };
}

function buildCashIndicator(
  input: BuildBusinessHealthInput,
): BusinessHealthIndicator {
  if (input.current_shift) {
    return {
      id: "cash_status",
      label: "Cash Status",
      display_value: "N/A",
      level: null,
      detail: "Cash reconciliation applies after the shift is closed.",
    };
  }

  if (!input.latest_closed_shift) {
    return {
      id: "cash_status",
      label: "Cash Status",
      display_value: "N/A",
      level: null,
      detail: "No closed shift available for cash status.",
    };
  }

  if (!input.cash_reconciliation) {
    return {
      id: "cash_status",
      label: "Cash Status",
      display_value: "Pending",
      level: "attention",
      detail: "Closed shift has not been reconciled yet.",
    };
  }

  if (input.cash_reconciliation.difference === 0) {
    return {
      id: "cash_status",
      label: "Cash Status",
      display_value: "Balanced",
      level: "healthy",
      detail: "Stored reconciliation difference is zero.",
    };
  }

  return {
    id: "cash_status",
    label: "Cash Status",
    display_value: "Difference",
    level: "critical",
    detail: "Stored cash reconciliation reports a difference.",
  };
}

function buildInventoryIndicator(
  input: BuildBusinessHealthInput,
): BusinessHealthIndicator {
  if (input.low_stock_alerts === null) {
    return {
      id: "inventory_status",
      label: "Inventory Status",
      display_value: "Unknown",
      level: "attention",
      detail: "Low stock alerts are not available.",
    };
  }

  let hasCritical = false;
  let hasLow = false;
  for (const alert of input.low_stock_alerts) {
    if (alert.alert_level === "critical") {
      hasCritical = true;
    } else if (alert.alert_level === "low") {
      hasLow = true;
    }
  }

  if (hasCritical) {
    return {
      id: "inventory_status",
      label: "Inventory Status",
      display_value: "Critical",
      level: "critical",
      detail: "Critical inventory alerts are present.",
    };
  }

  if (hasLow) {
    return {
      id: "inventory_status",
      label: "Inventory Status",
      display_value: "Attention",
      level: "attention",
      detail: "Low inventory alerts are present.",
    };
  }

  return {
    id: "inventory_status",
    label: "Inventory Status",
    display_value: "Healthy",
    level: "healthy",
    detail: "No inventory alerts.",
  };
}

function buildAlertCountIndicator(
  input: BuildBusinessHealthInput,
): BusinessHealthIndicator {
  if (input.low_stock_alerts === null) {
    return {
      id: "alert_count",
      label: "Alert Count",
      display_value: "—",
      level: "attention",
      detail: "Alert count is unavailable.",
    };
  }

  const count = input.low_stock_alerts.length;
  return {
    id: "alert_count",
    label: "Alert Count",
    display_value: String(count),
    level: count === 0 ? "healthy" : null,
    detail:
      count === 0
        ? "No inventory alerts."
        : "Count of inventory alerts from the read model.",
  };
}

function resolveOverallLevel(
  indicators: readonly BusinessHealthIndicator[],
): BusinessHealthLevel {
  let overall: BusinessHealthLevel = "healthy";

  for (const indicator of indicators) {
    if (!indicator.level) {
      continue;
    }
    overall = worseLevel(overall, indicator.level);
  }

  return overall;
}

function buildOverallDetail(
  level: BusinessHealthLevel,
  indicators: readonly BusinessHealthIndicator[],
): string {
  if (level === "healthy") {
    return "All available status indicators are healthy.";
  }

  const reasons = indicators
    .filter(
      (indicator) =>
        indicator.level === level ||
        (level === "attention" && indicator.level === "attention") ||
        (level === "critical" && indicator.level === "critical"),
    )
    .map((indicator) => indicator.label);

  const unique = [...new Set(reasons)];
  if (unique.length === 0) {
    return level === "critical"
      ? "One or more critical indicators require attention."
      : "One or more indicators need attention.";
  }

  return `Driven by: ${unique.join(", ")}.`;
}

/**
 * Build Business Health from existing read-model status facts.
 */
export function buildBusinessHealth(
  input: BuildBusinessHealthInput,
): { data: BusinessHealthModel; error: string | null } {
  const indicators: BusinessHealthIndicator[] = [
    buildShiftIndicator(input),
    buildCashIndicator(input),
    buildInventoryIndicator(input),
    buildAlertCountIndicator(input),
  ];

  const overallLevel = resolveOverallLevel(indicators);

  return {
    data: {
      overall_level: overallLevel,
      overall_display: formatOverallDisplay(overallLevel),
      overall_detail: buildOverallDetail(overallLevel, indicators),
      indicators,
    },
    error: null,
  };
}

/**
 * Project Business Health from a full Dashboard Read Model.
 */
export function buildBusinessHealthFromReadModel(
  readModel: DashboardReadModel,
): { data: BusinessHealthModel; error: string | null } {
  return buildBusinessHealth({
    current_shift: readModel.current_shift
      ? {
          id: readModel.current_shift.id,
          status: readModel.current_shift.status,
        }
      : null,
    latest_closed_shift: readModel.latest_closed_shift
      ? {
          id: readModel.latest_closed_shift.id,
          status: readModel.latest_closed_shift.status,
        }
      : null,
    cash_reconciliation: readModel.cash_reconciliation
      ? { difference: readModel.cash_reconciliation.difference }
      : null,
    low_stock_alerts: readModel.low_stock_alerts,
  });
}
