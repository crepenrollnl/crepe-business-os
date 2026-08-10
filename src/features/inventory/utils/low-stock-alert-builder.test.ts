/**
 * Pure builder coverage for Low Stock Alerts (DEV-120).
 */

import { describe, expect, it } from "vitest";
import type { InventoryForecast } from "../types/inventory-forecast";
import type { PurchaseRecommendation } from "../types/purchase-recommendation";
import {
  buildLowStockAlert,
  buildLowStockAlerts,
  sortLowStockAlerts,
} from "./low-stock-alert-builder";

const FLOUR_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MILK_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SUGAR_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function forecast(
  overrides?: Partial<InventoryForecast>,
): InventoryForecast {
  return {
    ingredient_id: FLOUR_ID,
    ingredient_name: "Flour",
    unit: "kg",
    current_quantity: 30,
    average_daily_consumption: 2,
    days_remaining: 15,
    status: "healthy",
    ...overrides,
  };
}

function recommendation(
  overrides?: Partial<PurchaseRecommendation>,
): PurchaseRecommendation {
  return {
    ingredient_id: FLOUR_ID,
    ingredient_name: "Flour",
    unit: "kg",
    current_quantity: 30,
    target_stock: 28,
    suggested_order_quantity: null,
    recommendation_status: "none",
    reason: "Stock is healthy; no replenishment needed.",
    forecast_status: "healthy",
    ...overrides,
  };
}

describe("low-stock-alert-builder (DEV-120)", () => {
  it("emits no alert for healthy inventory", () => {
    const result = buildLowStockAlert({
      forecast: forecast({
        current_quantity: 40,
        days_remaining: 20,
        status: "healthy",
      }),
      recommendation: recommendation({
        current_quantity: 40,
        suggested_order_quantity: null,
        recommendation_status: "none",
        reason: "Stock is healthy; no replenishment needed.",
        forecast_status: "healthy",
      }),
    });

    expect(result.error).toBeNull();
    expect(result.data).toBeNull();
  });

  it("builds a low alert from low forecast + recommendation", () => {
    const result = buildLowStockAlert({
      forecast: forecast({
        current_quantity: 10,
        days_remaining: 5,
        status: "low",
      }),
      recommendation: recommendation({
        current_quantity: 10,
        target_stock: 28,
        suggested_order_quantity: 18,
        recommendation_status: "recommended",
        reason: "Forecast is low; replenish to target stock.",
        forecast_status: "low",
      }),
    });

    expect(result.error).toBeNull();
    expect(result.data).toMatchObject({
      ingredient_id: FLOUR_ID,
      ingredient_name: "Flour",
      alert_level: "low",
      current_quantity: 10,
      days_remaining: 5,
      recommended_quantity: 18,
      alert_reason: "Forecast is low; replenish to target stock.",
    });
  });

  it("builds a critical alert from critical forecast", () => {
    const result = buildLowStockAlert({
      forecast: forecast({
        current_quantity: 4,
        days_remaining: 2,
        status: "critical",
      }),
      recommendation: recommendation({
        current_quantity: 4,
        suggested_order_quantity: 24,
        recommendation_status: "urgent",
        reason: "Forecast is critical; replenish to target stock.",
        forecast_status: "critical",
      }),
    });

    expect(result.error).toBeNull();
    expect(result.data?.alert_level).toBe("critical");
    expect(result.data?.recommended_quantity).toBe(24);
    expect(result.data?.alert_reason).toMatch(/critical/i);
  });

  it("treats zero inventory as critical when forecast status is critical", () => {
    const result = buildLowStockAlert({
      forecast: forecast({
        current_quantity: 0,
        days_remaining: 0,
        status: "critical",
      }),
      recommendation: recommendation({
        current_quantity: 0,
        suggested_order_quantity: 28,
        recommendation_status: "urgent",
        reason: "Out of stock; replenish to target stock.",
        forecast_status: "critical",
      }),
    });

    expect(result.error).toBeNull();
    expect(result.data?.alert_level).toBe("critical");
    expect(result.data?.current_quantity).toBe(0);
    expect(result.data?.recommended_quantity).toBe(28);
  });

  it("treats zero inventory with null forecast status as critical", () => {
    const result = buildLowStockAlert({
      forecast: forecast({
        current_quantity: 0,
        average_daily_consumption: 0,
        days_remaining: null,
        status: null,
      }),
      recommendation: recommendation({
        current_quantity: 0,
        suggested_order_quantity: 5,
        recommendation_status: "urgent",
        reason: "Out of stock; replenish to target stock.",
        forecast_status: null,
      }),
    });

    expect(result.error).toBeNull();
    expect(result.data?.alert_level).toBe("critical");
    expect(result.data?.days_remaining).toBeNull();
  });

  it("treats negative inventory as critical", () => {
    const result = buildLowStockAlert({
      forecast: forecast({
        current_quantity: -2,
        days_remaining: null,
        status: null,
      }),
      recommendation: recommendation({
        current_quantity: -2,
        suggested_order_quantity: 30,
        recommendation_status: "urgent",
        reason: "Negative stock; replenish to target stock.",
        forecast_status: null,
      }),
    });

    expect(result.error).toBeNull();
    expect(result.data?.alert_level).toBe("critical");
    expect(result.data?.current_quantity).toBe(-2);
    expect(result.data?.alert_reason).toMatch(/negative/i);
  });

  it("emits no alert when forecast is missing", () => {
    const result = buildLowStockAlert({
      forecast: null,
      recommendation: recommendation({
        suggested_order_quantity: 10,
        recommendation_status: "recommended",
      }),
    });

    expect(result.error).toBeNull();
    expect(result.data).toBeNull();
  });

  it("orders critical before low, then by days remaining", () => {
    const built = buildLowStockAlerts({
      forecasts: [
        forecast({
          ingredient_id: SUGAR_ID,
          ingredient_name: "Sugar",
          current_quantity: 12,
          days_remaining: 6,
          status: "low",
        }),
        forecast({
          ingredient_id: MILK_ID,
          ingredient_name: "Milk",
          current_quantity: 2,
          days_remaining: 1,
          status: "critical",
        }),
        forecast({
          ingredient_id: FLOUR_ID,
          ingredient_name: "Flour",
          current_quantity: 4,
          days_remaining: 2,
          status: "critical",
        }),
        forecast({
          ingredient_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          ingredient_name: "Butter",
          current_quantity: 40,
          days_remaining: 20,
          status: "healthy",
        }),
      ],
      recommendationsByIngredientId: new Map([
        [
          MILK_ID,
          recommendation({
            ingredient_id: MILK_ID,
            ingredient_name: "Milk",
            suggested_order_quantity: 20,
            recommendation_status: "urgent",
            reason: "Forecast is critical; replenish to target stock.",
            forecast_status: "critical",
          }),
        ],
        [
          FLOUR_ID,
          recommendation({
            suggested_order_quantity: 24,
            recommendation_status: "urgent",
            reason: "Forecast is critical; replenish to target stock.",
            forecast_status: "critical",
          }),
        ],
        [
          SUGAR_ID,
          recommendation({
            ingredient_id: SUGAR_ID,
            ingredient_name: "Sugar",
            suggested_order_quantity: 16,
            recommendation_status: "recommended",
            reason: "Forecast is low; replenish to target stock.",
            forecast_status: "low",
          }),
        ],
      ]),
    });

    expect(built.error).toBeNull();
    expect(built.data?.map((alert) => alert.ingredient_name)).toEqual([
      "Milk",
      "Flour",
      "Sugar",
    ]);
    expect(built.data?.[0]?.alert_level).toBe("critical");
    expect(built.data?.[2]?.alert_level).toBe("low");
  });

  it("sortLowStockAlerts is stable for equal severity and days", () => {
    const sorted = sortLowStockAlerts([
      {
        ingredient_id: SUGAR_ID,
        ingredient_name: "Sugar",
        unit: "kg",
        alert_level: "low",
        current_quantity: 8,
        days_remaining: 5,
        recommended_quantity: 10,
        alert_reason: "Forecast is low; replenish to target stock.",
      },
      {
        ingredient_id: FLOUR_ID,
        ingredient_name: "Flour",
        unit: "kg",
        alert_level: "low",
        current_quantity: 9,
        days_remaining: 5,
        recommended_quantity: 12,
        alert_reason: "Forecast is low; replenish to target stock.",
      },
    ]);

    expect(sorted.map((alert) => alert.ingredient_name)).toEqual([
      "Flour",
      "Sugar",
    ]);
  });
});
