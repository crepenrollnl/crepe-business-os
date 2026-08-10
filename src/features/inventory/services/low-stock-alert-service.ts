/**
 * Low Stock Alert read service (DEV-120).
 *
 * Projects informational alerts from Inventory Forecast + Purchase Recommendation.
 * Read-only — never creates purchase orders or mutates inventory.
 */

import { fail, ok, type ServiceResult } from "@/types/service";
import type { InventoryForecast } from "../types/inventory-forecast";
import type { PurchaseRecommendation } from "../types/purchase-recommendation";
import type { LowStockAlert } from "../types/low-stock-alert";
import {
  buildLowStockAlert,
  buildLowStockAlerts,
  groupLowStockAlertsBySeverity,
  sortLowStockAlerts,
} from "../utils/low-stock-alert-builder";
import { inventoryForecastService } from "./inventory-forecast-service";
import { purchaseRecommendationService } from "./purchase-recommendation-service";

/**
 * `instanceof Map` alone doesn't narrow `Iterable<V> | ReadonlyMap<K, V>`,
 * because `ReadonlyMap` lacks Map's mutator methods and so isn't assignable
 * to `Map<any, any>` for TS to exclude it from the non-Map branch. A
 * user-defined type predicate narrows both branches correctly.
 */
function isReadonlyMap<K, V>(
  value: Iterable<V> | ReadonlyMap<K, V>,
): value is ReadonlyMap<K, V> {
  return value instanceof Map;
}

export const lowStockAlertService = {
  buildLowStockAlert,
  buildLowStockAlerts,
  sortLowStockAlerts,
  groupLowStockAlertsBySeverity,

  /**
   * Build alerts from already-loaded forecast + recommendation maps.
   * Preferred path for Inventory page (avoids duplicate service queries).
   */
  buildAlertsFromMaps(input: {
    forecasts: Iterable<InventoryForecast> | ReadonlyMap<string, InventoryForecast>;
    recommendations:
      | Iterable<PurchaseRecommendation>
      | ReadonlyMap<string, PurchaseRecommendation>;
  }): ServiceResult<LowStockAlert[]> {
    try {
      const forecasts = isReadonlyMap(input.forecasts)
        ? input.forecasts.values()
        : input.forecasts;

      const recommendationsByIngredientId = isReadonlyMap(
        input.recommendations,
      )
        ? input.recommendations
        : new Map(
            [...input.recommendations].map((row) => [
              row.ingredient_id,
              row,
            ]),
          );

      const built = buildLowStockAlerts({
        forecasts,
        recommendationsByIngredientId,
      });

      if (built.error || !built.data) {
        return fail(built.error ?? "Failed to build low stock alerts");
      }

      return ok(built.data);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to build low stock alerts";
      return fail(message);
    }
  },

  /**
   * Convenience loader: reuses forecast + recommendation services.
   * Does not recalculate days remaining or suggested quantities.
   */
  async getLowStockAlerts(): Promise<ServiceResult<LowStockAlert[]>> {
    try {
      const [forecastResult, recommendationResult] = await Promise.all([
        inventoryForecastService.getInventoryForecastMap(),
        purchaseRecommendationService.getPurchaseRecommendationMap(),
      ]);

      if (forecastResult.error || !forecastResult.data) {
        return fail(
          forecastResult.error ?? "Failed to load inventory forecast",
        );
      }

      if (recommendationResult.error || !recommendationResult.data) {
        return fail(
          recommendationResult.error ??
            "Failed to load purchase recommendations",
        );
      }

      return this.buildAlertsFromMaps({
        forecasts: forecastResult.data,
        recommendations: recommendationResult.data,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to load low stock alerts";
      return fail(message);
    }
  },
};
