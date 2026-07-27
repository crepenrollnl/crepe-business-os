/**
 * Service-level coverage for purchasingReviewService (DEV-121).
 *
 * Composes existing advisory maps only — no mutations.
 */

import { describe, expect, it, vi } from "vitest";

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

import { purchasingReviewService } from "./purchasing-review-service";
import type { InventoryForecast } from "../types/inventory-forecast";
import type { LowStockAlert } from "../types/low-stock-alert";
import type { PurchaseRecommendation } from "../types/purchase-recommendation";
import type { SupplierInsight } from "../types/supplier-insight";

const FLOUR_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MILK_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function forecast(
  overrides?: Partial<InventoryForecast>,
): InventoryForecast {
  return {
    ingredient_id: FLOUR_ID,
    ingredient_name: "Flour",
    unit: "kg",
    current_quantity: 40,
    average_daily_consumption: 2,
    days_remaining: 20,
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
    current_quantity: 40,
    target_stock: 28,
    suggested_order_quantity: null,
    recommendation_status: "none",
    reason: "Stock is healthy; no replenishment needed.",
    forecast_status: "healthy",
    ...overrides,
  };
}

function insight(
  overrides?: Partial<SupplierInsight>,
): SupplierInsight {
  return {
    ingredient_id: FLOUR_ID,
    last_supplier_id: "11111111-1111-4111-8111-111111111111",
    last_supplier_name: "Alpha Foods",
    last_purchase_date: "2026-07-20T10:00:00.000Z",
    last_purchase_price: 2.4,
    most_frequent_supplier_id: "11111111-1111-4111-8111-111111111111",
    most_frequent_supplier_name: "Alpha Foods",
    purchase_count: 3,
    ...overrides,
  };
}

describe("purchasingReviewService (DEV-121)", () => {
  it("composes a healthy purchasing review from existing maps", () => {
    const result = purchasingReviewService.buildReviewFromMaps({
      ingredients: [
        {
          id: FLOUR_ID,
          name: "Flour",
          unit: "kg",
          current_stock: 40,
        },
      ],
      forecasts: new Map([[FLOUR_ID, forecast()]]),
      recommendations: new Map([[FLOUR_ID, recommendation()]]),
      supplierInsights: new Map([[FLOUR_ID, insight()]]),
      alerts: [],
      availability: {
        forecast: true,
        recommendation: true,
        supplier_insight: true,
        alerts: true,
      },
    });

    expect(result.error).toBeNull();
    expect(result.data?.rows).toHaveLength(1);
    expect(result.data?.rows[0]).toMatchObject({
      forecast_status: "healthy",
      recommendation_status: "none",
      last_supplier_name: "Alpha Foods",
      alert_level: null,
    });
    expect(result.data?.informational_messages).toEqual([]);
  });

  it("composes critical review with recommendation and alert display", () => {
    const alerts: LowStockAlert[] = [
      {
        ingredient_id: FLOUR_ID,
        ingredient_name: "Flour",
        unit: "kg",
        alert_level: "critical",
        current_quantity: 4,
        days_remaining: 2,
        recommended_quantity: 24,
        alert_reason: "Forecast is critical; replenish to target stock.",
      },
    ];

    const result = purchasingReviewService.buildReviewFromMaps({
      ingredients: [
        {
          id: FLOUR_ID,
          name: "Flour",
          unit: "kg",
          current_stock: 4,
        },
      ],
      forecasts: new Map([
        [
          FLOUR_ID,
          forecast({
            current_quantity: 4,
            days_remaining: 2,
            status: "critical",
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
      ]),
      supplierInsights: new Map([[FLOUR_ID, insight({ purchase_count: 1 })]]),
      alerts,
      availability: {
        forecast: true,
        recommendation: true,
        supplier_insight: true,
        alerts: true,
      },
    });

    expect(result.error).toBeNull();
    const row = result.data?.rows[0];
    expect(row?.alert_level).toBe("critical");
    expect(row?.suggested_order_quantity).toBe(24);
    expect(row?.recommendation_status).toBe("urgent");
    expect(row?.purchase_count).toBe(1);
  });

  it("surfaces informational messages when advisory services are unavailable", () => {
    const result = purchasingReviewService.buildReviewFromMaps({
      ingredients: [
        {
          id: MILK_ID,
          name: "Milk",
          unit: "L",
          current_stock: 10,
        },
      ],
      forecasts: new Map(),
      recommendations: new Map(),
      supplierInsights: new Map(),
      alerts: [],
      availability: {
        forecast: false,
        recommendation: false,
        supplier_insight: false,
        alerts: false,
      },
    });

    expect(result.error).toBeNull();
    expect(result.data?.rows[0]?.forecast_available).toBe(false);
    expect(result.data?.rows[0]?.recommendation_available).toBe(false);
    expect(result.data?.rows[0]?.supplier_insight_available).toBe(false);
    expect(result.data?.informational_messages.length).toBe(4);
  });

  it("maps review rows by ingredient id", () => {
    const result = purchasingReviewService.buildReviewFromMaps({
      ingredients: [
        {
          id: FLOUR_ID,
          name: "Flour",
          unit: "kg",
          current_stock: 40,
        },
      ],
      forecasts: new Map([[FLOUR_ID, forecast()]]),
      recommendations: new Map([[FLOUR_ID, recommendation()]]),
      supplierInsights: new Map([[FLOUR_ID, insight()]]),
      alerts: [],
      availability: {
        forecast: true,
        recommendation: true,
        supplier_insight: true,
        alerts: true,
      },
    });

    const map = purchasingReviewService.toReviewMap(result.data!);
    expect(map.get(FLOUR_ID)?.ingredient_name).toBe("Flour");
  });
});
