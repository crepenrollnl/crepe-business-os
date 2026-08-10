/**
 * Purchase Recommendation contracts (DEV-118).
 *
 * Advisory replenishment suggestions from Inventory Forecast (DEV-117).
 * Never creates purchase orders or mutates inventory.
 */

import type { InventoryForecastStatus } from "./inventory-forecast";

export const PURCHASE_RECOMMENDATION_STATUSES = [
  "none",
  "recommended",
  "urgent",
] as const;

export type PurchaseRecommendationStatus =
  (typeof PURCHASE_RECOMMENDATION_STATUSES)[number];

/**
 * Configurable target-stock policy.
 * Target = max(minimum_stock, avg_daily × targetCoverDays) when avg > 0;
 * otherwise Target = minimum_stock (or explicit override).
 */
export interface PurchaseRecommendationConfig {
  /** Days of cover used to derive target stock from average daily usage. */
  targetCoverDays: number;
}

export const DEFAULT_PURCHASE_RECOMMENDATION_CONFIG: PurchaseRecommendationConfig =
  {
    targetCoverDays: 14,
  };

export interface PurchaseRecommendation {
  ingredient_id: string;
  ingredient_name: string;
  unit: string;
  current_quantity: number;
  target_stock: number;
  /** Target − Current when Current < Target; null when no recommendation. */
  suggested_order_quantity: number | null;
  recommendation_status: PurchaseRecommendationStatus;
  reason: string;
  /** Forecast status used as input (may be null when no usage history). */
  forecast_status: InventoryForecastStatus | null;
}

export interface PurchaseRecommendationBuilderInput {
  ingredient_id: string;
  ingredient_name: string;
  unit: string;
  current_quantity: number;
  average_daily_consumption: number;
  forecast_status: InventoryForecastStatus | null;
  /** Ingredient minimum_stock floor for target calculation. */
  minimum_stock: number;
  /**
   * Optional explicit target override (configurable target stock).
   * When set, skips cover-days derivation.
   */
  target_stock?: number;
  target_cover_days?: number;
  /**
   * Ingredient ids already recommended in this generation pass
   * (duplicate protection).
   */
  already_recommended_ids?: readonly string[];
}
