/**
 * Purchasing Review contracts (DEV-121).
 *
 * Composed read model from Inventory Forecast, Purchase Recommendation,
 * Supplier Insights, and Low Stock Alerts.
 * Never recalculates advisory values. Never creates purchase orders.
 */

import type { InventoryForecastStatus } from "./inventory-forecast";
import type { LowStockAlertLevel } from "./low-stock-alert";
import type { PurchaseRecommendationStatus } from "./purchase-recommendation";

/** Per-ingredient purchasing decision view (display-only). */
export interface PurchasingReviewRow {
  ingredient_id: string;
  ingredient_name: string;
  unit: string;
  /** From forecast when present; otherwise inventory current_stock. */
  current_quantity: number;
  average_daily_usage: number | null;
  days_remaining: number | null;
  forecast_status: InventoryForecastStatus | null;
  forecast_available: boolean;
  suggested_order_quantity: number | null;
  target_stock: number | null;
  recommendation_status: PurchaseRecommendationStatus | null;
  recommendation_reason: string | null;
  recommendation_available: boolean;
  last_supplier_name: string | null;
  last_purchase_date: string | null;
  last_purchase_price: number | null;
  purchase_count: number | null;
  supplier_insight_available: boolean;
  alert_level: LowStockAlertLevel | null;
  alert_reason: string | null;
}

export interface PurchasingReviewAvailability {
  forecast: boolean;
  recommendation: boolean;
  supplier_insight: boolean;
  alerts: boolean;
}

export interface PurchasingReview {
  rows: PurchasingReviewRow[];
  availability: PurchasingReviewAvailability;
  /** Informational messages when supporting services have no usable data. */
  informational_messages: string[];
}

export interface PurchasingReviewForecastFact {
  current_quantity: number;
  average_daily_consumption: number;
  days_remaining: number | null;
  status: InventoryForecastStatus | null;
}

export interface PurchasingReviewRecommendationFact {
  suggested_order_quantity: number | null;
  target_stock: number;
  recommendation_status: PurchaseRecommendationStatus;
  reason: string;
}

export interface PurchasingReviewSupplierInsightFact {
  last_supplier_name: string | null;
  last_purchase_date: string | null;
  last_purchase_price: number | null;
  purchase_count: number;
}

export interface PurchasingReviewAlertFact {
  alert_level: LowStockAlertLevel;
  alert_reason: string;
}

export interface BuildPurchasingReviewRowInput {
  ingredient_id: string;
  ingredient_name: string;
  unit: string;
  /** Inventory master current stock (fallback when forecast missing). */
  current_stock: number;
  forecast: PurchasingReviewForecastFact | null;
  recommendation: PurchasingReviewRecommendationFact | null;
  supplier_insight: PurchasingReviewSupplierInsightFact | null;
  alert: PurchasingReviewAlertFact | null;
}

export interface BuildPurchasingReviewIngredientFact {
  id: string;
  name: string;
  unit: string;
  current_stock: number;
}

export interface BuildPurchasingReviewInput {
  ingredients: ReadonlyArray<BuildPurchasingReviewIngredientFact>;
  forecastsByIngredientId: ReadonlyMap<string, PurchasingReviewForecastFact>;
  recommendationsByIngredientId: ReadonlyMap<
    string,
    PurchasingReviewRecommendationFact
  >;
  supplierInsightsByIngredientId: ReadonlyMap<
    string,
    PurchasingReviewSupplierInsightFact
  >;
  alertsByIngredientId: ReadonlyMap<string, PurchasingReviewAlertFact>;
  availability: PurchasingReviewAvailability;
}
