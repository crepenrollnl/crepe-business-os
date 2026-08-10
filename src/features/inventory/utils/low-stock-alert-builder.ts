/**
 * Low Stock Alert pure builder (DEV-120).
 *
 * Projects alerts from existing forecast + recommendation facts.
 * Does not recalculate days remaining or suggested order quantity.
 */

import type { InventoryForecast } from "../types/inventory-forecast";
import type { PurchaseRecommendation } from "../types/purchase-recommendation";
import type {
  BuildLowStockAlertInput,
  LowStockAlert,
  LowStockAlertLevel,
} from "../types/low-stock-alert";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ALERT_LEVEL_ORDER: Record<LowStockAlertLevel, number> = {
  critical: 0,
  low: 1,
};

export function validateBuildLowStockAlertInput(
  input: BuildLowStockAlertInput,
): string | null {
  if (!input.forecast && !input.recommendation) {
    return null;
  }

  if (input.forecast) {
    if (
      !input.forecast.ingredient_id ||
      !UUID_RE.test(input.forecast.ingredient_id.trim())
    ) {
      return "Ingredient id is required.";
    }
    if (
      !input.forecast.ingredient_name ||
      input.forecast.ingredient_name.trim().length === 0
    ) {
      return "Ingredient name is required.";
    }
    if (!input.forecast.unit || input.forecast.unit.trim().length === 0) {
      return "Unit is required.";
    }
    if (!Number.isFinite(input.forecast.current_quantity)) {
      return "Current quantity must be a finite number.";
    }
  }

  if (input.recommendation) {
    if (
      !input.recommendation.ingredient_id ||
      !UUID_RE.test(input.recommendation.ingredient_id.trim())
    ) {
      return "Recommendation ingredient id is required.";
    }
    if (
      input.forecast &&
      input.recommendation.ingredient_id.trim() !==
        input.forecast.ingredient_id.trim()
    ) {
      return "Forecast and recommendation ingredient ids must match.";
    }
    if (
      input.recommendation.suggested_order_quantity !== null &&
      (!Number.isFinite(input.recommendation.suggested_order_quantity) ||
        input.recommendation.suggested_order_quantity < 0)
    ) {
      return "Recommended quantity must be a non-negative number.";
    }
  }

  return null;
}

function resolveAlertLevel(input: {
  forecastStatus: InventoryForecast["status"];
  currentQuantity: number;
}): LowStockAlertLevel | null {
  if (input.forecastStatus === "critical") {
    return "critical";
  }
  if (input.forecastStatus === "low") {
    return "low";
  }
  if (input.forecastStatus === "healthy") {
    return null;
  }

  // Missing / null forecast status: still surface zero or negative stock.
  if (input.currentQuantity <= 0) {
    return "critical";
  }

  return null;
}

function resolveAlertReason(input: {
  alertLevel: LowStockAlertLevel;
  currentQuantity: number;
  recommendationReason: string | null;
}): string {
  if (input.recommendationReason && input.recommendationReason.trim()) {
    return input.recommendationReason.trim();
  }

  if (input.currentQuantity < 0) {
    return "Negative stock requires immediate attention.";
  }

  if (input.currentQuantity === 0) {
    return "Out of stock; replenish inventory.";
  }

  if (input.alertLevel === "critical") {
    return "Forecast is critical; stock requires attention.";
  }

  return "Forecast is low; stock requires attention.";
}

/**
 * Build a single alert from forecast + recommendation facts.
 * Returns null data when healthy or when no attention is required.
 */
export function buildLowStockAlert(
  input: BuildLowStockAlertInput,
): { data: LowStockAlert | null; error: string | null } {
  const validationError = validateBuildLowStockAlertInput(input);
  if (validationError) {
    return { data: null, error: validationError };
  }

  if (!input.forecast) {
    // Missing forecast — no alert (cannot classify without forecast facts).
    // Zero/negative without forecast still needs a quantity signal; without
    // forecast there is no ingredient identity/quantity to alert on.
    return { data: null, error: null };
  }

  const forecast = input.forecast;
  const alertLevel = resolveAlertLevel({
    forecastStatus: forecast.status,
    currentQuantity: forecast.current_quantity,
  });

  if (!alertLevel) {
    return { data: null, error: null };
  }

  const recommendation = input.recommendation;
  const recommendedQuantity =
    recommendation?.suggested_order_quantity ?? null;

  return {
    data: {
      ingredient_id: forecast.ingredient_id.trim(),
      ingredient_name: forecast.ingredient_name.trim(),
      unit: forecast.unit.trim(),
      alert_level: alertLevel,
      current_quantity: forecast.current_quantity,
      days_remaining: forecast.days_remaining,
      recommended_quantity: recommendedQuantity,
      alert_reason: resolveAlertReason({
        alertLevel,
        currentQuantity: forecast.current_quantity,
        recommendationReason: recommendation?.reason ?? null,
      }),
    },
    error: null,
  };
}

/**
 * Build alerts from already-loaded forecast + recommendation maps.
 * Does not recalculate forecast or recommendation values.
 */
export function buildLowStockAlerts(input: {
  forecasts: Iterable<InventoryForecast>;
  recommendationsByIngredientId?: ReadonlyMap<string, PurchaseRecommendation>;
}): { data: LowStockAlert[] | null; error: string | null } {
  const alerts: LowStockAlert[] = [];
  const recommendations = input.recommendationsByIngredientId ?? new Map();

  for (const forecast of input.forecasts) {
    const built = buildLowStockAlert({
      forecast,
      recommendation: recommendations.get(forecast.ingredient_id) ?? null,
    });

    if (built.error) {
      return { data: null, error: built.error };
    }

    if (built.data) {
      alerts.push(built.data);
    }
  }

  return { data: sortLowStockAlerts(alerts), error: null };
}

/**
 * Critical first, then Low; within a level, fewer days remaining first,
 * then ingredient name.
 */
export function sortLowStockAlerts(alerts: readonly LowStockAlert[]): LowStockAlert[] {
  return [...alerts].sort((a, b) => {
    const levelDiff =
      ALERT_LEVEL_ORDER[a.alert_level] - ALERT_LEVEL_ORDER[b.alert_level];
    if (levelDiff !== 0) {
      return levelDiff;
    }

    const aDays = a.days_remaining;
    const bDays = b.days_remaining;
    if (aDays === null && bDays !== null) {
      return 1;
    }
    if (aDays !== null && bDays === null) {
      return -1;
    }
    if (aDays !== null && bDays !== null && aDays !== bDays) {
      return aDays - bDays;
    }

    return a.ingredient_name.localeCompare(b.ingredient_name, undefined, {
      sensitivity: "base",
    });
  });
}

export function groupLowStockAlertsBySeverity(alerts: readonly LowStockAlert[]): {
  critical: LowStockAlert[];
  low: LowStockAlert[];
} {
  const critical: LowStockAlert[] = [];
  const low: LowStockAlert[] = [];

  for (const alert of sortLowStockAlerts(alerts)) {
    if (alert.alert_level === "critical") {
      critical.push(alert);
    } else {
      low.push(alert);
    }
  }

  return { critical, low };
}
