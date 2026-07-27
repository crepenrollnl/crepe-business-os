/**
 * Pure builder coverage for Purchase Recommendations (DEV-118).
 */

import { describe, expect, it } from "vitest";
import type { InventoryForecast } from "../types/inventory-forecast";
import {
  assertUniquePurchaseRecommendationGeneration,
  buildPurchaseRecommendation,
  buildPurchaseRecommendationFromForecast,
  calculateTargetStock,
} from "./purchase-recommendation-builder";

const INGREDIENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function forecast(
  overrides?: Partial<InventoryForecast>,
): InventoryForecast {
  return {
    ingredient_id: INGREDIENT_ID,
    ingredient_name: "Flour",
    unit: "kg",
    current_quantity: 30,
    average_daily_consumption: 2,
    days_remaining: 15,
    status: "healthy",
    ...overrides,
  };
}

describe("purchase-recommendation-builder (DEV-118)", () => {
  it("returns no recommendation for healthy stock above target", () => {
    const result = buildPurchaseRecommendationFromForecast({
      forecast: forecast({
        current_quantity: 40,
        average_daily_consumption: 2,
        days_remaining: 20,
        status: "healthy",
      }),
      minimum_stock: 5,
      config: { targetCoverDays: 14 },
    });

    // target = max(5, 2*14) = 28; current 40 >= 28
    expect(result.error).toBeNull();
    expect(result.data?.target_stock).toBe(28);
    expect(result.data?.suggested_order_quantity).toBeNull();
    expect(result.data?.recommendation_status).toBe("none");
    expect(result.data?.reason).toMatch(/healthy/i);
  });

  it("recommends replenishment for low forecast stock", () => {
    const result = buildPurchaseRecommendationFromForecast({
      forecast: forecast({
        current_quantity: 10,
        average_daily_consumption: 2,
        days_remaining: 5,
        status: "low",
      }),
      minimum_stock: 5,
      config: { targetCoverDays: 14 },
    });

    // target = 28; suggested = 18
    expect(result.error).toBeNull();
    expect(result.data?.suggested_order_quantity).toBe(18);
    expect(result.data?.recommendation_status).toBe("recommended");
    expect(result.data?.reason).toMatch(/low/i);
  });

  it("marks critical forecast as urgent", () => {
    const result = buildPurchaseRecommendationFromForecast({
      forecast: forecast({
        current_quantity: 4,
        average_daily_consumption: 2,
        days_remaining: 2,
        status: "critical",
      }),
      minimum_stock: 5,
      config: { targetCoverDays: 14 },
    });

    expect(result.error).toBeNull();
    expect(result.data?.suggested_order_quantity).toBe(24);
    expect(result.data?.recommendation_status).toBe("urgent");
    expect(result.data?.reason).toMatch(/critical/i);
  });

  it("handles zero stock as urgent replenishment", () => {
    const result = buildPurchaseRecommendationFromForecast({
      forecast: forecast({
        current_quantity: 0,
        average_daily_consumption: 2,
        days_remaining: 0,
        status: "critical",
      }),
      minimum_stock: 5,
      config: { targetCoverDays: 14 },
    });

    expect(result.error).toBeNull();
    expect(result.data?.suggested_order_quantity).toBe(28);
    expect(result.data?.recommendation_status).toBe("urgent");
    expect(result.data?.reason).toMatch(/out of stock/i);
  });

  it("handles negative stock as urgent replenishment", () => {
    const result = buildPurchaseRecommendation({
      ingredient_id: INGREDIENT_ID,
      ingredient_name: "Flour",
      unit: "kg",
      current_quantity: -2,
      average_daily_consumption: 1,
      forecast_status: "critical",
      minimum_stock: 10,
      target_cover_days: 14,
    });

    // target = max(10, 14) = 14; suggested = 16
    expect(result.error).toBeNull();
    expect(result.data?.suggested_order_quantity).toBe(16);
    expect(result.data?.recommendation_status).toBe("urgent");
    expect(result.data?.reason).toMatch(/negative/i);
  });

  it("supports configurable explicit target stock", () => {
    const result = buildPurchaseRecommendationFromForecast({
      forecast: forecast({
        current_quantity: 5,
        average_daily_consumption: 2,
        status: "low",
      }),
      minimum_stock: 5,
      target_stock: 50,
    });

    expect(result.error).toBeNull();
    expect(result.data?.target_stock).toBe(50);
    expect(result.data?.suggested_order_quantity).toBe(45);
  });

  it("uses calculateTargetStock cover-days policy", () => {
    expect(
      calculateTargetStock({
        current_quantity: 10,
        average_daily_consumption: 3,
        minimum_stock: 5,
        target_cover_days: 10,
      }),
    ).toBe(30);

    expect(
      calculateTargetStock({
        current_quantity: 10,
        average_daily_consumption: 0,
        minimum_stock: 12,
        target_cover_days: 10,
      }),
    ).toBe(12);
  });

  it("rejects duplicate recommendation generation", () => {
    expect(
      assertUniquePurchaseRecommendationGeneration(INGREDIENT_ID, [
        INGREDIENT_ID,
      ]),
    ).toBe(
      "Purchase recommendation has already been generated for this ingredient.",
    );

    const result = buildPurchaseRecommendationFromForecast({
      forecast: forecast(),
      minimum_stock: 5,
      already_recommended_ids: [INGREDIENT_ID],
    });

    expect(result.data).toBeNull();
    expect(result.error).toMatch(/already been generated/i);
  });
});
