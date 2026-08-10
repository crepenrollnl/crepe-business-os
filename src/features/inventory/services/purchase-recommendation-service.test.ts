/**
 * Service-level coverage for purchaseRecommendationService (DEV-118).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { getInventoryForecastsMock, getInventoryMock } = vi.hoisted(() => ({
  getInventoryForecastsMock: vi.fn(),
  getInventoryMock: vi.fn(),
}));

vi.mock("./inventory-forecast-service", () => ({
  inventoryForecastService: {
    getInventoryForecasts: getInventoryForecastsMock,
  },
}));

vi.mock("./inventory-service", () => ({
  inventoryService: {
    getInventory: getInventoryMock,
  },
}));

import { purchaseRecommendationService } from "./purchase-recommendation-service";
import type { InventoryForecast } from "../types/inventory-forecast";

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

describe("purchaseRecommendationService (DEV-118)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    purchaseRecommendationService.clearGeneratedRecommendationRegistry();
  });

  it("builds recommendations from forecasts without writing purchases", async () => {
    getInventoryForecastsMock.mockResolvedValue({
      data: [
        forecast({
          ingredient_id: FLOUR_ID,
          current_quantity: 10,
          average_daily_consumption: 2,
          days_remaining: 5,
          status: "low",
        }),
        forecast({
          ingredient_id: MILK_ID,
          ingredient_name: "Milk",
          unit: "L",
          current_quantity: 40,
          average_daily_consumption: 1,
          days_remaining: 40,
          status: "healthy",
        }),
      ],
      error: null,
    });
    getInventoryMock.mockResolvedValue({
      data: [
        { id: FLOUR_ID, minimum_stock: 5 },
        { id: MILK_ID, minimum_stock: 2 },
      ],
      error: null,
    });

    const result =
      await purchaseRecommendationService.getPurchaseRecommendations({
        recommendationConfig: { targetCoverDays: 14 },
      });

    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(2);

    const flour = result.data?.find((row) => row.ingredient_id === FLOUR_ID);
    expect(flour).toEqual(
      expect.objectContaining({
        target_stock: 28,
        suggested_order_quantity: 18,
        recommendation_status: "recommended",
      }),
    );

    const milk = result.data?.find((row) => row.ingredient_id === MILK_ID);
    expect(milk).toEqual(
      expect.objectContaining({
        suggested_order_quantity: null,
        recommendation_status: "none",
      }),
    );
  });

  it("supports configurable target stock overrides", async () => {
    getInventoryForecastsMock.mockResolvedValue({
      data: [
        forecast({
          current_quantity: 5,
          average_daily_consumption: 1,
          status: "critical",
          days_remaining: 5,
        }),
      ],
      error: null,
    });
    getInventoryMock.mockResolvedValue({
      data: [{ id: FLOUR_ID, minimum_stock: 5 }],
      error: null,
    });

    const result =
      await purchaseRecommendationService.getPurchaseRecommendations({
        targetStockByIngredientId: new Map([[FLOUR_ID, 100]]),
      });

    expect(result.error).toBeNull();
    expect(result.data?.[0]?.target_stock).toBe(100);
    expect(result.data?.[0]?.suggested_order_quantity).toBe(95);
    expect(result.data?.[0]?.recommendation_status).toBe("urgent");
  });

  it("buildRecommendationMap enforces duplicate protection", () => {
    const first = purchaseRecommendationService.buildRecommendationMap({
      forecasts: [
        forecast({
          current_quantity: 5,
          average_daily_consumption: 2,
          status: "low",
        }),
      ],
      minimumStockByIngredientId: new Map([[FLOUR_ID, 5]]),
    });
    expect(first.error).toBeNull();

    // Same pass duplicate via already-registered id
    purchaseRecommendationService.clearGeneratedRecommendationRegistry();
    const duplicate =
      purchaseRecommendationService.buildRecommendationMap({
        forecasts: [
          forecast(),
          forecast({ ingredient_name: "Flour Dup" }),
        ],
        minimumStockByIngredientId: new Map([[FLOUR_ID, 5]]),
      });

    expect(duplicate.data).toBeNull();
    expect(duplicate.error).toMatch(/already been generated/i);
  });

  it("marks zero stock urgent via map builder", () => {
    const result = purchaseRecommendationService.buildRecommendationMap({
      forecasts: [
        forecast({
          current_quantity: 0,
          average_daily_consumption: 2,
          days_remaining: 0,
          status: "critical",
        }),
      ],
      minimumStockByIngredientId: new Map([[FLOUR_ID, 5]]),
      recommendationConfig: { targetCoverDays: 14 },
    });

    expect(result.error).toBeNull();
    expect(result.data?.get(FLOUR_ID)).toEqual(
      expect.objectContaining({
        suggested_order_quantity: 28,
        recommendation_status: "urgent",
      }),
    );
  });
});
