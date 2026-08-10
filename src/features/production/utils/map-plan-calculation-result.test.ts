import { describe, expect, it } from "vitest";

import {
  deriveIngredientRequirementStatus,
  formatIngredientRequirementStatus,
} from "./derive-ingredient-requirement-status";
import { formatProcurementReason } from "./format-procurement-reason";
import { mapPlanCalculationResult } from "./map-plan-calculation-result";
import type {
  PlanningResult,
  ProcurementRecommendation,
  ShoppingList,
} from "@/features/production-planning";

describe("deriveIngredientRequirementStatus", () => {
  it("returns available when there is no shortage", () => {
    expect(deriveIngredientRequirementStatus(10, 0)).toBe("available");
    expect(formatIngredientRequirementStatus("available")).toBe("Available");
  });

  it("returns missing when stock is zero and shortage exists", () => {
    expect(deriveIngredientRequirementStatus(0, 5)).toBe("missing");
    expect(formatIngredientRequirementStatus("missing")).toBe("Missing");
  });

  it("returns low stock when partial stock remains with a shortage", () => {
    expect(deriveIngredientRequirementStatus(3, 2)).toBe("low_stock");
    expect(formatIngredientRequirementStatus("low_stock")).toBe("Low Stock");
  });
});

describe("formatProcurementReason", () => {
  it("formats known domain reasons", () => {
    expect(formatProcurementReason("NoPackagingData")).toBe(
      "No packaging data",
    );
    expect(formatProcurementReason("RoundedToPackage")).toBe(
      "Rounded to package",
    );
  });
});

describe("mapPlanCalculationResult", () => {
  it("maps domain pipeline outputs into workspace rows", () => {
    const planningResult = {
      plan: {
        id: "plan-1",
        name: "Plan",
        status: "ready_for_purchase",
        plannedDate: "2026-07-20",
        notes: null,
        createdAt: "2026-07-20T08:00:00.000Z",
        updatedAt: "2026-07-20T08:00:00.000Z",
      },
      lines: [],
      ingredientRequirements: [
        {
          ingredientId: "flour",
          ingredientName: "Flour",
          requiredQuantity: 10,
          availableQuantity: 4,
          shortageQuantity: 6,
          unit: "kg",
        },
        {
          ingredientId: "milk",
          ingredientName: "Milk",
          requiredQuantity: 2,
          availableQuantity: 5,
          shortageQuantity: 0,
          unit: "L",
        },
      ],
      summary: {
        lineCount: 1,
        ingredientCount: 2,
        availableIngredientCount: 1,
        shortageLineCount: 1,
        totalPlannedQuantity: 10,
        totalRequiredQuantity: 12,
        totalShortageQuantity: 6,
        hasShortages: true,
        isInventorySufficient: false,
        status: "ready_for_purchase",
      },
    } satisfies PlanningResult;

    const shoppingList = {
      items: [
        {
          ingredientId: "flour",
          ingredientName: "Flour",
          unit: "kg",
          shortageQuantity: 6,
          currentStock: 4,
          requiredQuantity: 10,
        },
      ],
      summary: {
        totalItems: 1,
        totalMissingQuantity: 6,
        ingredientsToBuy: 1,
      },
    } satisfies ShoppingList;

    const recommendation = {
      items: [
        {
          ingredientId: "flour",
          ingredientName: "Flour",
          shortageQuantity: 6,
          recommendedPurchaseQuantity: 6,
          unit: "kg",
          packagesToBuy: 1,
          roundingApplied: false,
          recommendationReason: "NoPackagingData",
        },
      ],
      summary: {
        totalIngredients: 1,
        totalPackages: 1,
        totalPurchaseQuantity: 6,
      },
    } satisfies ProcurementRecommendation;

    const mapped = mapPlanCalculationResult(
      planningResult,
      shoppingList,
      recommendation,
    );

    expect(mapped.has_shortages).toBe(true);
    expect(mapped.ingredient_requirements).toEqual([
      {
        ingredient_id: "flour",
        ingredient_name: "Flour",
        required_quantity: 10,
        available_quantity: 4,
        missing_quantity: 6,
        unit: "kg",
        status: "low_stock",
      },
      {
        ingredient_id: "milk",
        ingredient_name: "Milk",
        required_quantity: 2,
        available_quantity: 5,
        missing_quantity: 0,
        unit: "L",
        status: "available",
      },
    ]);
    expect(mapped.shopping_list).toEqual([
      {
        ingredient_id: "flour",
        ingredient_name: "Flour",
        quantity: 6,
        unit: "kg",
      },
    ]);
    expect(mapped.procurement_recommendations).toEqual([
      {
        ingredient_id: "flour",
        ingredient_name: "Flour",
        recommended_quantity: 6,
        packages: 1,
        reason: "No packaging data",
        unit: "kg",
      },
    ]);
    expect(mapped.purchase_draft_review).toEqual([
      {
        supplier_name: null,
        ingredient_id: "flour",
        ingredient_name: "Flour",
        quantity: 6,
        packages: 1,
        reason: "No packaging data",
        unit: "kg",
      },
    ]);
    expect(mapped.purchase_draft_summary).toEqual({
      items: 1,
      packages: 1,
      total_purchase_quantity: 6,
    });
  });
});
