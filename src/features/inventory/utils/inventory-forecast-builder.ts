/**
 * Inventory Forecast pure builder (DEV-117).
 *
 * Days Remaining = Current Quantity / Average Daily Consumption
 * Average Daily = consumption_total / lookback_days
 * If average is zero → days_remaining = null (no prediction).
 */

import { roundQuantity } from "@/lib/quantity";
import type {
  InventoryForecast,
  InventoryForecastBuilderInput,
  InventoryForecastStatus,
  InventoryForecastThresholds,
} from "../types/inventory-forecast";
import { DEFAULT_INVENTORY_FORECAST_THRESHOLDS } from "../types/inventory-forecast";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const DAYS_REMAINING_DECIMAL_PLACES = 1;

function roundDaysRemaining(value: number): number {
  const factor = 10 ** DAYS_REMAINING_DECIMAL_PLACES;
  return Math.round(value * factor) / factor;
}

export function validateInventoryForecastThresholds(
  thresholds: InventoryForecastThresholds,
): string | null {
  if (
    !Number.isFinite(thresholds.criticalDaysRemaining) ||
    thresholds.criticalDaysRemaining < 0
  ) {
    return "Critical days threshold must be a non-negative number.";
  }
  if (
    !Number.isFinite(thresholds.lowDaysRemaining) ||
    thresholds.lowDaysRemaining < 0
  ) {
    return "Low days threshold must be a non-negative number.";
  }
  if (thresholds.lowDaysRemaining < thresholds.criticalDaysRemaining) {
    return "Low days threshold must be greater than or equal to critical days threshold.";
  }
  if (
    !Number.isFinite(thresholds.lookbackDays) ||
    thresholds.lookbackDays <= 0
  ) {
    return "Lookback days must be greater than zero.";
  }
  return null;
}

/**
 * Classify advisory status from days remaining + configurable thresholds.
 * null days → null status (no consumption signal).
 */
export function classifyInventoryForecastStatus(
  daysRemaining: number | null,
  thresholds: Pick<
    InventoryForecastThresholds,
    "criticalDaysRemaining" | "lowDaysRemaining"
  > = DEFAULT_INVENTORY_FORECAST_THRESHOLDS,
): InventoryForecastStatus | null {
  if (daysRemaining === null) {
    return null;
  }

  if (daysRemaining <= thresholds.criticalDaysRemaining) {
    return "critical";
  }

  if (daysRemaining <= thresholds.lowDaysRemaining) {
    return "low";
  }

  return "healthy";
}

export function validateInventoryForecastBuilderInput(
  input: InventoryForecastBuilderInput,
): string | null {
  if (!input.ingredient_id || !UUID_RE.test(input.ingredient_id.trim())) {
    return "Ingredient id is required.";
  }
  if (!input.ingredient_name || input.ingredient_name.trim().length === 0) {
    return "Ingredient name is required.";
  }
  if (!input.unit || input.unit.trim().length === 0) {
    return "Unit is required.";
  }
  if (!Number.isFinite(input.current_quantity)) {
    return "Current quantity must be a finite number.";
  }
  if (input.current_quantity < 0) {
    return "Current quantity cannot be negative for forecast.";
  }
  if (!Number.isFinite(input.consumption_total) || input.consumption_total < 0) {
    return "Consumption total must be a non-negative number.";
  }
  if (!Number.isFinite(input.lookback_days) || input.lookback_days <= 0) {
    return "Lookback days must be greater than zero.";
  }
  return null;
}

/**
 * Build a single-ingredient advisory forecast from stored facts.
 */
export function buildInventoryForecast(
  input: InventoryForecastBuilderInput,
): { data: InventoryForecast | null; error: string | null } {
  const validationError = validateInventoryForecastBuilderInput(input);
  if (validationError) {
    return { data: null, error: validationError };
  }

  const thresholds = {
    criticalDaysRemaining:
      input.thresholds?.criticalDaysRemaining ??
      DEFAULT_INVENTORY_FORECAST_THRESHOLDS.criticalDaysRemaining,
    lowDaysRemaining:
      input.thresholds?.lowDaysRemaining ??
      DEFAULT_INVENTORY_FORECAST_THRESHOLDS.lowDaysRemaining,
  };

  const current_quantity = roundQuantity(input.current_quantity);
  const average_daily_consumption = roundQuantity(
    input.consumption_total / input.lookback_days,
  );

  let days_remaining: number | null = null;
  if (average_daily_consumption > 0) {
    days_remaining = roundDaysRemaining(
      current_quantity / average_daily_consumption,
    );
  }

  const status = classifyInventoryForecastStatus(days_remaining, thresholds);

  return {
    data: {
      ingredient_id: input.ingredient_id.trim(),
      ingredient_name: input.ingredient_name.trim(),
      unit: input.unit.trim(),
      current_quantity,
      average_daily_consumption,
      days_remaining,
      status,
    },
    error: null,
  };
}

/**
 * Assert read-model consistency: same inputs must yield same frozen-style output.
 */
export function assertInventoryForecastHistoricallyConsistent(input: {
  previous: InventoryForecast;
  next: InventoryForecast;
}): string | null {
  const { previous, next } = input;

  if (
    previous.ingredient_id !== next.ingredient_id ||
    previous.current_quantity !== next.current_quantity ||
    previous.average_daily_consumption !== next.average_daily_consumption ||
    previous.days_remaining !== next.days_remaining ||
    previous.status !== next.status
  ) {
    return "Inventory forecast facts are inconsistent for the same inputs.";
  }

  return null;
}
