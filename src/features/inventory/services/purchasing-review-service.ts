/**
 * Purchasing Review read service (DEV-121).
 *
 * Composes Inventory Forecast, Purchase Recommendation, Supplier Insights,
 * and Low Stock Alerts into a display-only decision view.
 * Read-only — never creates purchase orders or mutates inventory.
 */

import { fail, ok, type ServiceResult } from "@/types/service";
import type { InventoryForecast } from "../types/inventory-forecast";
import type { LowStockAlert } from "../types/low-stock-alert";
import type { PurchaseRecommendation } from "../types/purchase-recommendation";
import type {
  PurchasingReview,
  PurchasingReviewAvailability,
  PurchasingReviewRow,
} from "../types/purchasing-review";
import type { SupplierInsight } from "../types/supplier-insight";
import {
  assertPurchasingReviewHistoricallyConsistent,
  buildPurchasingReview,
  buildPurchasingReviewRow,
} from "../utils/purchasing-review-builder";
import { inventoryForecastService } from "./inventory-forecast-service";
import { inventoryService } from "./inventory-service";
import { lowStockAlertService } from "./low-stock-alert-service";
import { purchaseRecommendationService } from "./purchase-recommendation-service";
import { supplierInsightService } from "./supplier-insight-service";

function toForecastFact(forecast: InventoryForecast) {
  return {
    current_quantity: forecast.current_quantity,
    average_daily_consumption: forecast.average_daily_consumption,
    days_remaining: forecast.days_remaining,
    status: forecast.status,
  };
}

function toRecommendationFact(recommendation: PurchaseRecommendation) {
  return {
    suggested_order_quantity: recommendation.suggested_order_quantity,
    target_stock: recommendation.target_stock,
    recommendation_status: recommendation.recommendation_status,
    reason: recommendation.reason,
  };
}

function toInsightFact(insight: SupplierInsight) {
  return {
    last_supplier_name: insight.last_supplier_name,
    last_purchase_date: insight.last_purchase_date,
    last_purchase_price: insight.last_purchase_price,
    purchase_count: insight.purchase_count,
  };
}

function toAlertFact(alert: LowStockAlert) {
  return {
    alert_level: alert.alert_level,
    alert_reason: alert.alert_reason,
  };
}

export const purchasingReviewService = {
  buildPurchasingReviewRow,
  buildPurchasingReview,
  assertPurchasingReviewHistoricallyConsistent,

  /**
   * Preferred Inventory page path: compose from already-loaded service maps.
   * Does not recalculate advisory values.
   */
  buildReviewFromMaps(input: {
    ingredients: ReadonlyArray<{
      id: string;
      name: string;
      unit: string;
      current_stock: number;
    }>;
    forecasts: ReadonlyMap<string, InventoryForecast>;
    recommendations: ReadonlyMap<string, PurchaseRecommendation>;
    supplierInsights: ReadonlyMap<string, SupplierInsight>;
    alerts: readonly LowStockAlert[];
    availability: PurchasingReviewAvailability;
  }): ServiceResult<PurchasingReview> {
    try {
      const forecastsByIngredientId = new Map(
        [...input.forecasts.entries()].map(([id, forecast]) => [
          id,
          toForecastFact(forecast),
        ]),
      );
      const recommendationsByIngredientId = new Map(
        [...input.recommendations.entries()].map(([id, recommendation]) => [
          id,
          toRecommendationFact(recommendation),
        ]),
      );
      const supplierInsightsByIngredientId = new Map(
        [...input.supplierInsights.entries()].map(([id, insight]) => [
          id,
          toInsightFact(insight),
        ]),
      );
      const alertsByIngredientId = new Map(
        input.alerts.map((alert) => [alert.ingredient_id, toAlertFact(alert)]),
      );

      const built = buildPurchasingReview({
        ingredients: input.ingredients,
        forecastsByIngredientId,
        recommendationsByIngredientId,
        supplierInsightsByIngredientId,
        alertsByIngredientId,
        availability: input.availability,
      });

      if (built.error || !built.data) {
        return fail(built.error ?? "Failed to build purchasing review");
      }

      return ok(built.data);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to build purchasing review";
      return fail(message);
    }
  },

  /**
   * Convenience loader that reuses existing advisory services only.
   */
  async getPurchasingReview(): Promise<ServiceResult<PurchasingReview>> {
    try {
      const [inventoryResult, forecastResult] = await Promise.all([
        inventoryService.getInventory(),
        inventoryForecastService.getInventoryForecastMap(),
      ]);

      if (inventoryResult.error || !inventoryResult.data) {
        return fail(inventoryResult.error ?? "Failed to load inventory");
      }

      const items = inventoryResult.data;
      const forecasts = forecastResult.error
        ? new Map<string, InventoryForecast>()
        : (forecastResult.data ?? new Map<string, InventoryForecast>());

      const minimumStockByIngredientId = new Map(
        items.map((item) => [item.id, item.minimum_stock]),
      );
      const recommendationResult =
        purchaseRecommendationService.buildRecommendationMap({
          forecasts: forecasts.values(),
          minimumStockByIngredientId,
        });

      const recommendations = recommendationResult.error
        ? new Map<string, PurchaseRecommendation>()
        : (recommendationResult.data ??
          new Map<string, PurchaseRecommendation>());

      const insightResult = await supplierInsightService.getSupplierInsightMap(
        items.map((item) => item.id),
      );
      const supplierInsights = insightResult.error
        ? new Map<string, SupplierInsight>()
        : (insightResult.data ?? new Map<string, SupplierInsight>());

      const alertResult = lowStockAlertService.buildAlertsFromMaps({
        forecasts,
        recommendations,
      });
      const alerts = alertResult.error ? [] : (alertResult.data ?? []);

      return this.buildReviewFromMaps({
        ingredients: items.map((item) => ({
          id: item.id,
          name: item.name,
          unit: item.unit,
          current_stock: item.current_stock,
        })),
        forecasts,
        recommendations,
        supplierInsights,
        alerts,
        availability: {
          forecast: !forecastResult.error,
          recommendation: !recommendationResult.error,
          supplier_insight: !insightResult.error,
          alerts: !alertResult.error,
        },
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to load purchasing review";
      return fail(message);
    }
  },

  toReviewMap(
    review: PurchasingReview,
  ): Map<string, PurchasingReviewRow> {
    return new Map(review.rows.map((row) => [row.ingredient_id, row]));
  },
};
