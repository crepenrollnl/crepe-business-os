/**
 * Purchase Recommendation pure builder (DEV-118).
 *
 * Suggested Order Quantity = Target Stock − Current Quantity
 * When Current >= Target → no recommendation.
 * Uses Inventory Forecast facts; never creates purchases.
 */

import { roundQuantity } from "@/lib/quantity";
import type { InventoryForecast } from "../types/inventory-forecast";
import type {
  PurchaseRecommendation,
  PurchaseRecommendationBuilderInput,
  PurchaseRecommendationConfig,
  PurchaseRecommendationStatus,
} from "../types/purchase-recommendation";
import { DEFAULT_PURCHASE_RECOMMENDATION_CONFIG } from "../types/purchase-recommendation";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validatePurchaseRecommendationConfig(
  config: PurchaseRecommendationConfig,
): string | null {
  if (
    !Number.isFinite(config.targetCoverDays) ||
    config.targetCoverDays <= 0
  ) {
    return "Target cover days must be greater than zero.";
  }
  return null;
}

export function assertUniquePurchaseRecommendationGeneration(
  ingredientId: string,
  alreadyRecommendedIds: readonly string[],
): string | null {
  const trimmed = ingredientId?.trim() ?? "";
  if (!trimmed) {
    return "Ingredient id is required.";
  }
  if (alreadyRecommendedIds.includes(trimmed)) {
    return "Purchase recommendation has already been generated for this ingredient.";
  }
  return null;
}

export function calculateTargetStock(input: {
  current_quantity: number;
  average_daily_consumption: number;
  minimum_stock: number;
  target_cover_days: number;
  target_stock_override?: number;
}): number {
  if (
    input.target_stock_override !== undefined &&
    Number.isFinite(input.target_stock_override)
  ) {
    return roundQuantity(Math.max(0, input.target_stock_override));
  }

  const minimum = roundQuantity(Math.max(0, input.minimum_stock));
  const avg = roundQuantity(Math.max(0, input.average_daily_consumption));

  if (avg > 0) {
    const coverTarget = roundQuantity(avg * input.target_cover_days);
    return roundQuantity(Math.max(minimum, coverTarget));
  }

  return minimum;
}

export function classifyPurchaseRecommendationStatus(input: {
  current_quantity: number;
  suggested_order_quantity: number | null;
  forecast_status: PurchaseRecommendationBuilderInput["forecast_status"];
}): PurchaseRecommendationStatus {
  if (
    input.suggested_order_quantity === null ||
    input.suggested_order_quantity <= 0
  ) {
    return "none";
  }

  if (
    input.current_quantity <= 0 ||
    input.forecast_status === "critical"
  ) {
    return "urgent";
  }

  if (input.forecast_status === "low") {
    return "recommended";
  }

  // Below target without a low/critical forecast (e.g. minimum floor).
  return "recommended";
}

export function buildPurchaseRecommendationReason(input: {
  recommendation_status: PurchaseRecommendationStatus;
  current_quantity: number;
  target_stock: number;
  forecast_status: PurchaseRecommendationBuilderInput["forecast_status"];
}): string {
  if (input.current_quantity < 0) {
    return "Negative stock; replenish to target stock.";
  }

  if (input.current_quantity === 0) {
    return "Out of stock; replenish to target stock.";
  }

  if (input.recommendation_status === "none") {
    if (input.forecast_status === "healthy") {
      return "Stock is healthy; no replenishment needed.";
    }
    return "Current quantity meets or exceeds target stock.";
  }

  if (input.forecast_status === "critical") {
    return "Forecast is critical; replenish to target stock.";
  }

  if (input.forecast_status === "low") {
    return "Forecast is low; replenish to target stock.";
  }

  return "Below target stock; replenish to target stock.";
}

export function validatePurchaseRecommendationBuilderInput(
  input: PurchaseRecommendationBuilderInput,
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
  if (
    !Number.isFinite(input.average_daily_consumption) ||
    input.average_daily_consumption < 0
  ) {
    return "Average daily consumption must be a non-negative number.";
  }
  if (!Number.isFinite(input.minimum_stock) || input.minimum_stock < 0) {
    return "Minimum stock must be a non-negative number.";
  }
  if (
    input.target_stock !== undefined &&
    (!Number.isFinite(input.target_stock) || input.target_stock < 0)
  ) {
    return "Target stock must be a non-negative number.";
  }
  if (
    input.target_cover_days !== undefined &&
    (!Number.isFinite(input.target_cover_days) || input.target_cover_days <= 0)
  ) {
    return "Target cover days must be greater than zero.";
  }

  const duplicateError = assertUniquePurchaseRecommendationGeneration(
    input.ingredient_id,
    input.already_recommended_ids ?? [],
  );
  if (duplicateError) {
    return duplicateError;
  }

  return null;
}

/**
 * Build one advisory purchase recommendation from forecast + target policy.
 */
export function buildPurchaseRecommendation(
  input: PurchaseRecommendationBuilderInput,
): { data: PurchaseRecommendation | null; error: string | null } {
  const validationError = validatePurchaseRecommendationBuilderInput(input);
  if (validationError) {
    return { data: null, error: validationError };
  }

  const targetCoverDays =
    input.target_cover_days ??
    DEFAULT_PURCHASE_RECOMMENDATION_CONFIG.targetCoverDays;

  const current_quantity = roundQuantity(input.current_quantity);
  const target_stock = calculateTargetStock({
    current_quantity,
    average_daily_consumption: input.average_daily_consumption,
    minimum_stock: input.minimum_stock,
    target_cover_days: targetCoverDays,
    target_stock_override: input.target_stock,
  });

  let suggested_order_quantity: number | null = null;
  if (current_quantity < target_stock) {
    suggested_order_quantity = roundQuantity(target_stock - current_quantity);
  }

  const recommendation_status = classifyPurchaseRecommendationStatus({
    current_quantity,
    suggested_order_quantity,
    forecast_status: input.forecast_status,
  });

  const reason = buildPurchaseRecommendationReason({
    recommendation_status,
    current_quantity,
    target_stock,
    forecast_status: input.forecast_status,
  });

  return {
    data: {
      ingredient_id: input.ingredient_id.trim(),
      ingredient_name: input.ingredient_name.trim(),
      unit: input.unit.trim(),
      current_quantity,
      target_stock,
      suggested_order_quantity,
      recommendation_status,
      reason,
      forecast_status: input.forecast_status,
    },
    error: null,
  };
}

/**
 * Build from a DEV-117 forecast row + minimum stock.
 */
export function buildPurchaseRecommendationFromForecast(input: {
  forecast: InventoryForecast;
  minimum_stock: number;
  config?: PurchaseRecommendationConfig;
  target_stock?: number;
  already_recommended_ids?: readonly string[];
}): { data: PurchaseRecommendation | null; error: string | null } {
  return buildPurchaseRecommendation({
    ingredient_id: input.forecast.ingredient_id,
    ingredient_name: input.forecast.ingredient_name,
    unit: input.forecast.unit,
    current_quantity: input.forecast.current_quantity,
    average_daily_consumption: input.forecast.average_daily_consumption,
    forecast_status: input.forecast.status,
    minimum_stock: input.minimum_stock,
    target_stock: input.target_stock,
    target_cover_days:
      input.config?.targetCoverDays ??
      DEFAULT_PURCHASE_RECOMMENDATION_CONFIG.targetCoverDays,
    already_recommended_ids: input.already_recommended_ids,
  });
}
