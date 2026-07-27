/**
 * Purchase Recommendation read service (DEV-118).
 *
 * Builds advisory replenishment suggestions from Inventory Forecast.
 * Read-only — never creates purchase orders or mutates inventory.
 */

import { fail, ok, type ServiceResult } from "@/types/service";
import { inventoryForecastService } from "./inventory-forecast-service";
import { inventoryService } from "./inventory-service";
import type { InventoryForecastThresholds } from "../types/inventory-forecast";
import { DEFAULT_INVENTORY_FORECAST_THRESHOLDS } from "../types/inventory-forecast";
import type { InventoryForecast } from "../types/inventory-forecast";
import type {
  PurchaseRecommendation,
  PurchaseRecommendationConfig,
} from "../types/purchase-recommendation";
import { DEFAULT_PURCHASE_RECOMMENDATION_CONFIG } from "../types/purchase-recommendation";
import {
  assertUniquePurchaseRecommendationGeneration,
  buildPurchaseRecommendation,
  buildPurchaseRecommendationFromForecast,
  calculateTargetStock,
  validatePurchaseRecommendationConfig,
} from "../utils/purchase-recommendation-builder";

/** In-process guard: one recommendation generation per ingredient per pass. */
const generatedRecommendationIds = new Set<string>();

export const purchaseRecommendationService = {
  buildPurchaseRecommendation,
  buildPurchaseRecommendationFromForecast,
  calculateTargetStock,
  assertUniquePurchaseRecommendationGeneration,
  DEFAULT_CONFIG: DEFAULT_PURCHASE_RECOMMENDATION_CONFIG,

  clearGeneratedRecommendationRegistry(): void {
    generatedRecommendationIds.clear();
  },

  /**
   * Read-only recommendations for all ingredients.
   * Reuses Inventory Forecast; applies configurable target stock policy.
   */
  async getPurchaseRecommendations(options?: {
    forecastThresholds?: InventoryForecastThresholds;
    recommendationConfig?: PurchaseRecommendationConfig;
    /** Explicit per-ingredient target stock overrides. */
    targetStockByIngredientId?: ReadonlyMap<string, number>;
  }): Promise<ServiceResult<PurchaseRecommendation[]>> {
    try {
      const config =
        options?.recommendationConfig ?? DEFAULT_PURCHASE_RECOMMENDATION_CONFIG;
      const configError = validatePurchaseRecommendationConfig(config);
      if (configError) {
        return fail(configError);
      }

      const forecastThresholds =
        options?.forecastThresholds ?? DEFAULT_INVENTORY_FORECAST_THRESHOLDS;

      const [forecastResult, inventoryResult] = await Promise.all([
        inventoryForecastService.getInventoryForecasts(forecastThresholds),
        inventoryService.getInventory(),
      ]);

      if (forecastResult.error || !forecastResult.data) {
        return fail(
          forecastResult.error ?? "Failed to load inventory forecast",
        );
      }

      if (inventoryResult.error || !inventoryResult.data) {
        return fail(inventoryResult.error ?? "Failed to load inventory");
      }

      const minimumById = new Map(
        inventoryResult.data.map((item) => [item.id, item.minimum_stock]),
      );

      this.clearGeneratedRecommendationRegistry();
      const recommendations: PurchaseRecommendation[] = [];

      for (const forecast of forecastResult.data) {
        const duplicateError = assertUniquePurchaseRecommendationGeneration(
          forecast.ingredient_id,
          [...generatedRecommendationIds],
        );
        if (duplicateError) {
          return fail(duplicateError);
        }

        const minimumStock = minimumById.get(forecast.ingredient_id) ?? 0;
        const targetOverride = options?.targetStockByIngredientId?.get(
          forecast.ingredient_id,
        );

        const built = buildPurchaseRecommendationFromForecast({
          forecast,
          minimum_stock: minimumStock,
          config,
          target_stock: targetOverride,
          already_recommended_ids: [...generatedRecommendationIds],
        });

        if (built.error || !built.data) {
          return fail(
            built.error ?? "Failed to build purchase recommendation",
          );
        }

        generatedRecommendationIds.add(forecast.ingredient_id);
        recommendations.push(built.data);
      }

      return ok(recommendations);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to load purchase recommendations";
      return fail(message);
    }
  },

  /**
   * Build recommendations from already-loaded forecast + minimum stock facts.
   * Avoids a second forecast query when the Inventory page already loaded forecasts.
   */
  buildRecommendationMap(input: {
    forecasts: Iterable<InventoryForecast>;
    minimumStockByIngredientId: ReadonlyMap<string, number>;
    recommendationConfig?: PurchaseRecommendationConfig;
    targetStockByIngredientId?: ReadonlyMap<string, number>;
  }): ServiceResult<Map<string, PurchaseRecommendation>> {
    try {
      const config =
        input.recommendationConfig ?? DEFAULT_PURCHASE_RECOMMENDATION_CONFIG;
      const configError = validatePurchaseRecommendationConfig(config);
      if (configError) {
        return fail(configError);
      }

      this.clearGeneratedRecommendationRegistry();
      const recommendations = new Map<string, PurchaseRecommendation>();

      for (const forecast of input.forecasts) {
        const duplicateError = assertUniquePurchaseRecommendationGeneration(
          forecast.ingredient_id,
          [...generatedRecommendationIds],
        );
        if (duplicateError) {
          return fail(duplicateError);
        }

        const built = buildPurchaseRecommendationFromForecast({
          forecast,
          minimum_stock:
            input.minimumStockByIngredientId.get(forecast.ingredient_id) ?? 0,
          config,
          target_stock: input.targetStockByIngredientId?.get(
            forecast.ingredient_id,
          ),
          already_recommended_ids: [...generatedRecommendationIds],
        });

        if (built.error || !built.data) {
          return fail(
            built.error ?? "Failed to build purchase recommendation",
          );
        }

        generatedRecommendationIds.add(forecast.ingredient_id);
        recommendations.set(forecast.ingredient_id, built.data);
      }

      return ok(recommendations);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to build purchase recommendations";
      return fail(message);
    }
  },

  async getPurchaseRecommendationMap(options?: {
    forecastThresholds?: InventoryForecastThresholds;
    recommendationConfig?: PurchaseRecommendationConfig;
    targetStockByIngredientId?: ReadonlyMap<string, number>;
  }): Promise<ServiceResult<Map<string, PurchaseRecommendation>>> {
    const result = await this.getPurchaseRecommendations(options);
    if (result.error || !result.data) {
      return fail(result.error ?? "Failed to load purchase recommendations");
    }

    return ok(
      new Map(result.data.map((row) => [row.ingredient_id, row])),
    );
  },
};
