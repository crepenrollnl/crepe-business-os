/**
 * Low Stock Alert contracts (DEV-120).
 *
 * Informational alerts derived from Inventory Forecast + Purchase Recommendation.
 * Never creates purchase orders or mutates inventory.
 */

export const LOW_STOCK_ALERT_LEVELS = ["critical", "low"] as const;

export type LowStockAlertLevel = (typeof LOW_STOCK_ALERT_LEVELS)[number];

/**
 * Read-model alert for one ingredient that requires attention.
 * Healthy inventory produces no alert.
 */
export interface LowStockAlert {
  ingredient_id: string;
  ingredient_name: string;
  unit: string;
  alert_level: LowStockAlertLevel;
  current_quantity: number;
  days_remaining: number | null;
  /** Suggested order quantity from purchase recommendation; null when none. */
  recommended_quantity: number | null;
  alert_reason: string;
}

export interface BuildLowStockAlertInput {
  /** Forecast for the ingredient; null when missing. */
  forecast: {
    ingredient_id: string;
    ingredient_name: string;
    unit: string;
    current_quantity: number;
    days_remaining: number | null;
    status: "healthy" | "low" | "critical" | null;
  } | null;
  /** Recommendation for the ingredient; null when missing. */
  recommendation: {
    ingredient_id: string;
    suggested_order_quantity: number | null;
    reason: string;
    recommendation_status: "none" | "recommended" | "urgent";
  } | null;
}
