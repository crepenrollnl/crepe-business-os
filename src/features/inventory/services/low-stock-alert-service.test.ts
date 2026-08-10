/**
 * Service-level coverage for lowStockAlertService (DEV-120).
 *
 * Reuses forecast + recommendation maps; no inventory mutations.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { supabaseMock } = vi.hoisted(() => {
  const supabaseMock = {
    from: vi.fn(),
    rpc: vi.fn(),
    auth: {
      getUser: vi.fn(),
    },
  };
  return { supabaseMock };
});

vi.mock("@/lib/supabase", () => ({
  supabase: supabaseMock,
}));

import { lowStockAlertService } from "./low-stock-alert-service";
import type { InventoryForecast } from "../types/inventory-forecast";
import type { PurchaseRecommendation } from "../types/purchase-recommendation";

const FLOUR_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MILK_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

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

describe("lowStockAlertService (DEV-120)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds alerts from existing forecast and recommendation maps", () => {
    const result = lowStockAlertService.buildAlertsFromMaps({
      forecasts: new Map([
        [
          FLOUR_ID,
          forecast({
            current_quantity: 4,
            days_remaining: 2,
            status: "critical",
          }),
        ],
        [
          MILK_ID,
          forecast({
            ingredient_id: MILK_ID,
            ingredient_name: "Milk",
            unit: "L",
            current_quantity: 10,
            days_remaining: 5,
            status: "low",
          }),
        ],
      ]),
      recommendations: new Map([
        [
          FLOUR_ID,
          recommendation({
            current_quantity: 4,
            suggested_order_quantity: 24,
            recommendation_status: "urgent",
            reason: "Forecast is critical; replenish to target stock.",
            forecast_status: "critical",
          }),
        ],
        [
          MILK_ID,
          recommendation({
            ingredient_id: MILK_ID,
            ingredient_name: "Milk",
            unit: "L",
            current_quantity: 10,
            suggested_order_quantity: 18,
            recommendation_status: "recommended",
            reason: "Forecast is low; replenish to target stock.",
            forecast_status: "low",
          }),
        ],
      ]),
    });

    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(2);
    expect(result.data?.[0]?.alert_level).toBe("critical");
    expect(result.data?.[0]?.ingredient_name).toBe("Flour");
    expect(result.data?.[1]?.alert_level).toBe("low");
    expect(result.data?.[1]?.recommended_quantity).toBe(18);
  });

  it("omits healthy inventory from alert list", () => {
    const result = lowStockAlertService.buildAlertsFromMaps({
      forecasts: [forecast({ status: "healthy", days_remaining: 20 })],
      recommendations: [
        recommendation({
          recommendation_status: "none",
          suggested_order_quantity: null,
        }),
      ],
    });

    expect(result.error).toBeNull();
    expect(result.data).toEqual([]);
  });

  it("does not invent alerts when forecast map is empty", () => {
    const result = lowStockAlertService.buildAlertsFromMaps({
      forecasts: new Map(),
      recommendations: new Map([
        [
          FLOUR_ID,
          recommendation({
            suggested_order_quantity: 10,
            recommendation_status: "recommended",
          }),
        ],
      ]),
    });

    expect(result.error).toBeNull();
    expect(result.data).toEqual([]);
  });
});
