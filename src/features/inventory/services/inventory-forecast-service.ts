/**
 * Inventory Forecast read service (DEV-117).
 *
 * Builds advisory forecasts from ingredients.current_stock and historical
 * production_out stock_movements. Read-only — never mutates inventory.
 */

import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import type {
  InventoryForecast,
  InventoryForecastThresholds,
} from "../types/inventory-forecast";
import { DEFAULT_INVENTORY_FORECAST_THRESHOLDS } from "../types/inventory-forecast";
import {
  assertInventoryForecastHistoricallyConsistent,
  buildInventoryForecast,
  classifyInventoryForecastStatus,
  validateInventoryForecastThresholds,
} from "../utils/inventory-forecast-builder";

interface IngredientStockRow {
  id: string;
  name: string;
  unit: string;
  current_stock: number | string;
}

interface StockMovementRow {
  ingredient_id: string;
  quantity: number | string;
  occurred_at: string;
  movement_type: string;
}

function toNumber(value: number | string): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
}

function mapForecastError(error: unknown, fallback: string): string {
  return toUserError(error, fallback, {
    map: (err) => {
      const message =
        typeof err === "object" &&
        err !== null &&
        "message" in err &&
        typeof (err as { message: unknown }).message === "string"
          ? (err as { message: string }).message
          : typeof err === "string"
            ? err
            : null;

      if (!message) {
        return null;
      }

      const normalized = message.toLowerCase();
      if (
        normalized.includes("stock_movements") &&
        (normalized.includes("does not exist") ||
          normalized.includes("schema cache") ||
          normalized.includes("42p01"))
      ) {
        return "Inventory forecast is not available yet. Apply stock movement history and try again.";
      }

      return null;
    },
  });
}

export const inventoryForecastService = {
  buildInventoryForecast,
  classifyInventoryForecastStatus,
  assertInventoryForecastHistoricallyConsistent,
  DEFAULT_THRESHOLDS: DEFAULT_INVENTORY_FORECAST_THRESHOLDS,

  /**
   * Read-only forecast for all raw materials.
   * Average daily usage = Σ production_out in lookback / lookback days.
   */
  async getInventoryForecasts(
    thresholds: InventoryForecastThresholds = DEFAULT_INVENTORY_FORECAST_THRESHOLDS,
  ): Promise<ServiceResult<InventoryForecast[]>> {
    try {
      const thresholdError = validateInventoryForecastThresholds(thresholds);
      if (thresholdError) {
        return fail(thresholdError);
      }

      const { data: ingredientRows, error: ingredientError } = await supabase
        .from("ingredients")
        .select("id, name, unit, current_stock")
        .order("name");

      if (ingredientError) {
        return fail(
          mapForecastError(ingredientError, "Failed to load inventory for forecast"),
        );
      }

      const ingredients = (ingredientRows ?? []) as IngredientStockRow[];
      if (ingredients.length === 0) {
        return ok([]);
      }

      const lookbackStart = new Date();
      lookbackStart.setUTCDate(
        lookbackStart.getUTCDate() - thresholds.lookbackDays,
      );
      const lookbackIso = lookbackStart.toISOString();

      const { data: movementRows, error: movementError } = await supabase
        .from("stock_movements")
        .select("ingredient_id, quantity, occurred_at, movement_type")
        .eq("movement_type", "production_out")
        .not("ingredient_id", "is", null)
        .gte("occurred_at", lookbackIso);

      if (movementError) {
        return fail(
          mapForecastError(
            movementError,
            "Failed to load consumption history for forecast",
          ),
        );
      }

      const consumptionByIngredient = new Map<string, number>();

      for (const row of (movementRows ?? []) as StockMovementRow[]) {
        if (row.movement_type !== "production_out") {
          continue;
        }
        if (!row.ingredient_id) {
          continue;
        }

        const quantity = toNumber(row.quantity);
        if (quantity === null || quantity < 0) {
          return fail("Consumption history quantity is invalid.");
        }

        consumptionByIngredient.set(
          row.ingredient_id,
          (consumptionByIngredient.get(row.ingredient_id) ?? 0) + quantity,
        );
      }

      const forecasts: InventoryForecast[] = [];

      for (const ingredient of ingredients) {
        const current = toNumber(ingredient.current_stock);
        if (current === null) {
          return fail("Ingredient current stock is invalid.");
        }

        // Negative stock: skip formula; surface as critical advisory with null days.
        if (current < 0) {
          forecasts.push({
            ingredient_id: ingredient.id,
            ingredient_name: ingredient.name,
            unit: ingredient.unit,
            current_quantity: current,
            average_daily_consumption: 0,
            days_remaining: null,
            status: "critical",
          });
          continue;
        }

        const built = buildInventoryForecast({
          ingredient_id: ingredient.id,
          ingredient_name: ingredient.name,
          unit: ingredient.unit,
          current_quantity: current,
          consumption_total: consumptionByIngredient.get(ingredient.id) ?? 0,
          lookback_days: thresholds.lookbackDays,
          thresholds: {
            criticalDaysRemaining: thresholds.criticalDaysRemaining,
            lowDaysRemaining: thresholds.lowDaysRemaining,
          },
        });

        if (built.error || !built.data) {
          return fail(built.error ?? "Failed to build inventory forecast");
        }

        forecasts.push(built.data);
      }

      return ok(forecasts);
    } catch (error) {
      return fail(mapForecastError(error, "Failed to load inventory forecast"));
    }
  },

  /**
   * Convenience map keyed by ingredient id for Inventory table enrichment.
   */
  async getInventoryForecastMap(
    thresholds: InventoryForecastThresholds = DEFAULT_INVENTORY_FORECAST_THRESHOLDS,
  ): Promise<ServiceResult<Map<string, InventoryForecast>>> {
    const result = await this.getInventoryForecasts(thresholds);
    if (result.error || !result.data) {
      return fail(result.error ?? "Failed to load inventory forecast");
    }

    return ok(new Map(result.data.map((row) => [row.ingredient_id, row])));
  },
};
