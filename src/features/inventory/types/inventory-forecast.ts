/**
 * Inventory Forecast contracts (DEV-117).
 *
 * Advisory read model from current stock + historical production_out.
 * Never mutates inventory. No AI / prediction models.
 */

export const INVENTORY_FORECAST_STATUSES = [
  "healthy",
  "low",
  "critical",
] as const;

export type InventoryForecastStatus =
  (typeof INVENTORY_FORECAST_STATUSES)[number];

/**
 * Configurable days-remaining thresholds and consumption lookback.
 * Override per call — defaults stay feature-local.
 */
export interface InventoryForecastThresholds {
  /** Days remaining at or below this → Critical. */
  criticalDaysRemaining: number;
  /** Days remaining at or below this (and above critical) → Low. */
  lowDaysRemaining: number;
  /** Calendar days used to average historical consumption. */
  lookbackDays: number;
}

export const DEFAULT_INVENTORY_FORECAST_THRESHOLDS: InventoryForecastThresholds =
  {
    criticalDaysRemaining: 3,
    lowDaysRemaining: 7,
    lookbackDays: 30,
  };

export interface InventoryForecast {
  ingredient_id: string;
  ingredient_name: string;
  unit: string;
  /** Current on-hand quantity (ingredients.current_stock). */
  current_quantity: number;
  /** Average daily consumption from historical production_out. */
  average_daily_consumption: number;
  /**
   * current_quantity / average_daily_consumption.
   * null when average consumption is zero (or current is negative).
   */
  days_remaining: number | null;
  /**
   * Indicator from days_remaining + thresholds.
   * null when days_remaining is null (no consumption signal).
   */
  status: InventoryForecastStatus | null;
}

/** Pure builder input for one ingredient. */
export interface InventoryForecastBuilderInput {
  ingredient_id: string;
  ingredient_name: string;
  unit: string;
  current_quantity: number;
  /** Total quantity consumed in the lookback window (production_out sum). */
  consumption_total: number;
  lookback_days: number;
  thresholds?: Pick<
    InventoryForecastThresholds,
    "criticalDaysRemaining" | "lowDaysRemaining"
  >;
}

/** Historical consumption fact from stock_movements. */
export interface InventoryConsumptionFact {
  ingredient_id: string;
  quantity: number;
  occurred_at: string;
  movement_type: string;
}
