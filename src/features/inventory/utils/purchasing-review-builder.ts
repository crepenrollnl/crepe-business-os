/**
 * Purchasing Review pure builder (DEV-121).
 *
 * Composes existing advisory facts into a display-only decision view.
 * Does not recalculate forecast, recommendation, insight, or alert values.
 */

import type {
  BuildPurchasingReviewInput,
  BuildPurchasingReviewRowInput,
  PurchasingReview,
  PurchasingReviewAvailability,
  PurchasingReviewRow,
} from "../types/purchasing-review";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateBuildPurchasingReviewRowInput(
  input: BuildPurchasingReviewRowInput,
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
  if (!Number.isFinite(input.current_stock)) {
    return "Current stock must be a finite number.";
  }
  return null;
}

export function buildPurchasingReviewInformationalMessages(
  availability: PurchasingReviewAvailability,
  options?: { ingredientCount: number },
): string[] {
  const messages: string[] = [];

  if (options?.ingredientCount === 0) {
    messages.push(
      "Inventory is empty. Add ingredients to start the purchasing review.",
    );
    return messages;
  }

  if (!availability.forecast) {
    messages.push(
      "Forecast data is unavailable. Days remaining and usage are not shown.",
    );
  }
  if (!availability.recommendation) {
    messages.push(
      "Purchase recommendations are unavailable. Suggested quantities are not shown.",
    );
  }
  if (!availability.supplier_insight) {
    messages.push(
      "Supplier purchase history is unavailable. Last supplier details are not shown.",
    );
  }
  if (!availability.alerts) {
    messages.push("Low stock alerts are unavailable.");
  }

  return messages;
}

/**
 * Compose one purchasing review row from existing service facts.
 * Missing supporting data stays null — never invented.
 */
export function buildPurchasingReviewRow(
  input: BuildPurchasingReviewRowInput,
): { data: PurchasingReviewRow | null; error: string | null } {
  const validationError = validateBuildPurchasingReviewRowInput(input);
  if (validationError) {
    return { data: null, error: validationError };
  }

  const forecast = input.forecast;
  const recommendation = input.recommendation;
  const insight = input.supplier_insight;
  const alert = input.alert;

  return {
    data: {
      ingredient_id: input.ingredient_id.trim(),
      ingredient_name: input.ingredient_name.trim(),
      unit: input.unit.trim(),
      current_quantity: forecast
        ? forecast.current_quantity
        : input.current_stock,
      average_daily_usage: forecast
        ? forecast.average_daily_consumption
        : null,
      days_remaining: forecast ? forecast.days_remaining : null,
      forecast_status: forecast ? forecast.status : null,
      forecast_available: forecast !== null,
      suggested_order_quantity: recommendation
        ? recommendation.suggested_order_quantity
        : null,
      target_stock: recommendation ? recommendation.target_stock : null,
      recommendation_status: recommendation
        ? recommendation.recommendation_status
        : null,
      recommendation_reason: recommendation ? recommendation.reason : null,
      recommendation_available: recommendation !== null,
      last_supplier_name: insight ? insight.last_supplier_name : null,
      last_purchase_date: insight ? insight.last_purchase_date : null,
      last_purchase_price: insight ? insight.last_purchase_price : null,
      purchase_count: insight ? insight.purchase_count : null,
      supplier_insight_available: insight !== null,
      alert_level: alert ? alert.alert_level : null,
      alert_reason: alert ? alert.alert_reason : null,
    },
    error: null,
  };
}

/**
 * Build the full purchasing review for the Inventory page.
 */
export function buildPurchasingReview(
  input: BuildPurchasingReviewInput,
): { data: PurchasingReview | null; error: string | null } {
  const rows: PurchasingReviewRow[] = [];

  for (const ingredient of input.ingredients) {
    const built = buildPurchasingReviewRow({
      ingredient_id: ingredient.id,
      ingredient_name: ingredient.name,
      unit: ingredient.unit,
      current_stock: ingredient.current_stock,
      forecast: input.forecastsByIngredientId.get(ingredient.id) ?? null,
      recommendation:
        input.recommendationsByIngredientId.get(ingredient.id) ?? null,
      supplier_insight:
        input.supplierInsightsByIngredientId.get(ingredient.id) ?? null,
      alert: input.alertsByIngredientId.get(ingredient.id) ?? null,
    });

    if (built.error || !built.data) {
      return {
        data: null,
        error: built.error ?? "Failed to build purchasing review row",
      };
    }

    rows.push(built.data);
  }

  return {
    data: {
      rows,
      availability: input.availability,
      informational_messages: buildPurchasingReviewInformationalMessages(
        input.availability,
        { ingredientCount: input.ingredients.length },
      ),
    },
    error: null,
  };
}

/**
 * Assert identical composed inputs produce an identical review row.
 */
export function assertPurchasingReviewHistoricallyConsistent(input: {
  previous: PurchasingReviewRow;
  next: PurchasingReviewRow;
}): string | null {
  const { previous, next } = input;
  const keys: (keyof PurchasingReviewRow)[] = [
    "ingredient_id",
    "ingredient_name",
    "unit",
    "current_quantity",
    "average_daily_usage",
    "days_remaining",
    "forecast_status",
    "forecast_available",
    "suggested_order_quantity",
    "target_stock",
    "recommendation_status",
    "recommendation_reason",
    "recommendation_available",
    "last_supplier_name",
    "last_purchase_date",
    "last_purchase_price",
    "purchase_count",
    "supplier_insight_available",
    "alert_level",
    "alert_reason",
  ];

  for (const key of keys) {
    if (previous[key] !== next[key]) {
      return "Purchasing review is inconsistent for the same advisory inputs.";
    }
  }

  return null;
}
