/**
 * Pure builder coverage for Inventory Forecast (DEV-117).
 */

import { describe, expect, it } from "vitest";
import {
  assertInventoryForecastHistoricallyConsistent,
  buildInventoryForecast,
  classifyInventoryForecastStatus,
  validateInventoryForecastThresholds,
} from "./inventory-forecast-builder";
import type { InventoryForecast } from "../types/inventory-forecast";

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

describe("inventory-forecast-builder (DEV-117)", () => {
  it("builds a normal forecast from current stock and consumption", () => {
    const result = buildInventoryForecast({
      ingredient_id: INGREDIENT_ID,
      ingredient_name: "Flour",
      unit: "kg",
      current_quantity: 30,
      consumption_total: 60,
      lookback_days: 30,
    });

    expect(result.error).toBeNull();
    expect(result.data).toEqual({
      ingredient_id: INGREDIENT_ID,
      ingredient_name: "Flour",
      unit: "kg",
      current_quantity: 30,
      average_daily_consumption: 2,
      days_remaining: 15,
      status: "healthy",
    });
  });

  it("returns null days remaining when consumption is zero", () => {
    const result = buildInventoryForecast({
      ingredient_id: INGREDIENT_ID,
      ingredient_name: "Flour",
      unit: "kg",
      current_quantity: 30,
      consumption_total: 0,
      lookback_days: 30,
    });

    expect(result.error).toBeNull();
    expect(result.data?.average_daily_consumption).toBe(0);
    expect(result.data?.days_remaining).toBeNull();
    expect(result.data?.status).toBeNull();
  });

  it("returns zero days remaining when inventory is zero and usage exists", () => {
    const result = buildInventoryForecast({
      ingredient_id: INGREDIENT_ID,
      ingredient_name: "Flour",
      unit: "kg",
      current_quantity: 0,
      consumption_total: 30,
      lookback_days: 30,
    });

    expect(result.error).toBeNull();
    expect(result.data?.current_quantity).toBe(0);
    expect(result.data?.days_remaining).toBe(0);
    expect(result.data?.status).toBe("critical");
  });

  it("classifies critical inventory from days remaining", () => {
    const result = buildInventoryForecast({
      ingredient_id: INGREDIENT_ID,
      ingredient_name: "Milk",
      unit: "L",
      current_quantity: 4,
      consumption_total: 60,
      lookback_days: 30,
      thresholds: {
        criticalDaysRemaining: 3,
        lowDaysRemaining: 7,
      },
    });

    // avg = 2/day, days = 2 → critical
    expect(result.error).toBeNull();
    expect(result.data?.days_remaining).toBe(2);
    expect(result.data?.status).toBe("critical");
  });

  it("supports configurable thresholds for low vs healthy", () => {
    expect(classifyInventoryForecastStatus(5, {
      criticalDaysRemaining: 3,
      lowDaysRemaining: 7,
    })).toBe("low");

    expect(classifyInventoryForecastStatus(5, {
      criticalDaysRemaining: 2,
      lowDaysRemaining: 4,
    })).toBe("healthy");

    expect(
      validateInventoryForecastThresholds({
        criticalDaysRemaining: 5,
        lowDaysRemaining: 3,
        lookbackDays: 30,
      }),
    ).toMatch(/low days threshold/i);
  });

  it("rejects negative inventory in the builder", () => {
    const result = buildInventoryForecast({
      ingredient_id: INGREDIENT_ID,
      ingredient_name: "Flour",
      unit: "kg",
      current_quantity: -1,
      consumption_total: 10,
      lookback_days: 30,
    });

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "Current quantity cannot be negative for forecast.",
    );
  });

  it("treats missing history (zero consumption) as null days", () => {
    const result = buildInventoryForecast({
      ingredient_id: INGREDIENT_ID,
      ingredient_name: "Sugar",
      unit: "kg",
      current_quantity: 12,
      consumption_total: 0,
      lookback_days: 14,
    });

    expect(result.error).toBeNull();
    expect(result.data?.days_remaining).toBeNull();
    expect(result.data?.status).toBeNull();
  });

  it("asserts historical consistency for identical forecasts", () => {
    const previous = forecast();
    expect(
      assertInventoryForecastHistoricallyConsistent({
        previous,
        next: { ...previous },
      }),
    ).toBeNull();

    expect(
      assertInventoryForecastHistoricallyConsistent({
        previous,
        next: forecast({ days_remaining: 10 }),
      }),
    ).toBe("Inventory forecast facts are inconsistent for the same inputs.");
  });
});
