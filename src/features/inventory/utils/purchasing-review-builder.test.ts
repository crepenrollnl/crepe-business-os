/**
 * Pure builder coverage for Purchasing Review (DEV-121).
 */

import { describe, expect, it } from "vitest";
import type { PurchasingReviewRow } from "../types/purchasing-review";
import {
  assertPurchasingReviewHistoricallyConsistent,
  buildPurchasingReview,
  buildPurchasingReviewInformationalMessages,
  buildPurchasingReviewRow,
} from "./purchasing-review-builder";

const FLOUR_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function healthyRowInput() {
  return {
    ingredient_id: FLOUR_ID,
    ingredient_name: "Flour",
    unit: "kg",
    current_stock: 40,
    forecast: {
      current_quantity: 40,
      average_daily_consumption: 2,
      days_remaining: 20,
      status: "healthy" as const,
    },
    recommendation: {
      suggested_order_quantity: null,
      target_stock: 28,
      recommendation_status: "none" as const,
      reason: "Stock is healthy; no replenishment needed.",
    },
    supplier_insight: {
      last_supplier_name: "Alpha Foods",
      last_purchase_date: "2026-07-20T10:00:00.000Z",
      last_purchase_price: 2.4,
      purchase_count: 3,
    },
    alert: null,
  };
}

describe("purchasing-review-builder (DEV-121)", () => {
  it("builds a healthy inventory purchasing review", () => {
    const result = buildPurchasingReviewRow(healthyRowInput());

    expect(result.error).toBeNull();
    expect(result.data).toMatchObject({
      ingredient_id: FLOUR_ID,
      current_quantity: 40,
      average_daily_usage: 2,
      days_remaining: 20,
      forecast_status: "healthy",
      forecast_available: true,
      suggested_order_quantity: null,
      target_stock: 28,
      recommendation_status: "none",
      recommendation_reason: "Stock is healthy; no replenishment needed.",
      last_supplier_name: "Alpha Foods",
      last_purchase_price: 2.4,
      purchase_count: 3,
      alert_level: null,
    });
  });

  it("builds a critical inventory purchasing review with alert", () => {
    const result = buildPurchasingReviewRow({
      ...healthyRowInput(),
      current_stock: 4,
      forecast: {
        current_quantity: 4,
        average_daily_consumption: 2,
        days_remaining: 2,
        status: "critical",
      },
      recommendation: {
        suggested_order_quantity: 24,
        target_stock: 28,
        recommendation_status: "urgent",
        reason: "Forecast is critical; replenish to target stock.",
      },
      alert: {
        alert_level: "critical",
        alert_reason: "Forecast is critical; replenish to target stock.",
      },
    });

    expect(result.error).toBeNull();
    expect(result.data?.forecast_status).toBe("critical");
    expect(result.data?.suggested_order_quantity).toBe(24);
    expect(result.data?.recommendation_status).toBe("urgent");
    expect(result.data?.alert_level).toBe("critical");
    expect(result.data?.alert_reason).toMatch(/critical/i);
  });

  it("displays supplier insight facts without inventing values", () => {
    const result = buildPurchasingReviewRow(healthyRowInput());

    expect(result.data?.last_supplier_name).toBe("Alpha Foods");
    expect(result.data?.last_purchase_date).toBe("2026-07-20T10:00:00.000Z");
    expect(result.data?.last_purchase_price).toBe(2.4);
    expect(result.data?.purchase_count).toBe(3);
    expect(result.data?.supplier_insight_available).toBe(true);
  });

  it("keeps recommendation display fields from the recommendation service", () => {
    const result = buildPurchasingReviewRow({
      ...healthyRowInput(),
      recommendation: {
        suggested_order_quantity: 18,
        target_stock: 28,
        recommendation_status: "recommended",
        reason: "Forecast is low; replenish to target stock.",
      },
    });

    expect(result.data?.suggested_order_quantity).toBe(18);
    expect(result.data?.target_stock).toBe(28);
    expect(result.data?.recommendation_status).toBe("recommended");
    expect(result.data?.recommendation_reason).toMatch(/low/i);
  });

  it("renders missing supporting data as null (no invented values)", () => {
    const result = buildPurchasingReviewRow({
      ingredient_id: FLOUR_ID,
      ingredient_name: "Flour",
      unit: "kg",
      current_stock: 12,
      forecast: null,
      recommendation: null,
      supplier_insight: null,
      alert: null,
    });

    expect(result.error).toBeNull();
    expect(result.data).toMatchObject({
      current_quantity: 12,
      average_daily_usage: null,
      days_remaining: null,
      forecast_status: null,
      forecast_available: false,
      suggested_order_quantity: null,
      target_stock: null,
      recommendation_status: null,
      recommendation_available: false,
      last_supplier_name: null,
      purchase_count: null,
      supplier_insight_available: false,
      alert_level: null,
    });
  });

  it("keeps no-purchase-history insight facts as zeros/nulls from the service", () => {
    const result = buildPurchasingReviewRow({
      ...healthyRowInput(),
      supplier_insight: {
        last_supplier_name: null,
        last_purchase_date: null,
        last_purchase_price: null,
        purchase_count: 0,
      },
    });

    expect(result.data?.purchase_count).toBe(0);
    expect(result.data?.last_supplier_name).toBeNull();
    expect(result.data?.supplier_insight_available).toBe(true);
  });

  it("reports informational messages for empty inventory and missing services", () => {
    expect(
      buildPurchasingReviewInformationalMessages(
        {
          forecast: true,
          recommendation: true,
          supplier_insight: true,
          alerts: true,
        },
        { ingredientCount: 0 },
      ),
    ).toEqual([
      "Inventory is empty. Add ingredients to start the purchasing review.",
    ]);

    expect(
      buildPurchasingReviewInformationalMessages({
        forecast: false,
        recommendation: false,
        supplier_insight: false,
        alerts: false,
      }),
    ).toEqual([
      "Forecast data is unavailable. Days remaining and usage are not shown.",
      "Purchase recommendations are unavailable. Suggested quantities are not shown.",
      "Supplier purchase history is unavailable. Last supplier details are not shown.",
      "Low stock alerts are unavailable.",
    ]);
  });

  it("builds an empty review for empty inventory", () => {
    const result = buildPurchasingReview({
      ingredients: [],
      forecastsByIngredientId: new Map(),
      recommendationsByIngredientId: new Map(),
      supplierInsightsByIngredientId: new Map(),
      alertsByIngredientId: new Map(),
      availability: {
        forecast: true,
        recommendation: true,
        supplier_insight: true,
        alerts: true,
      },
    });

    expect(result.error).toBeNull();
    expect(result.data?.rows).toEqual([]);
    expect(result.data?.informational_messages[0]).toMatch(/empty/i);
  });

  it("asserts historical consistency for identical advisory inputs", () => {
    const input = healthyRowInput();
    const first = buildPurchasingReviewRow(input);
    const second = buildPurchasingReviewRow({ ...input });

    expect(
      assertPurchasingReviewHistoricallyConsistent({
        previous: first.data as PurchasingReviewRow,
        next: second.data as PurchasingReviewRow,
      }),
    ).toBeNull();
  });
});
