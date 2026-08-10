import { describe, expect, it } from "vitest";

import type {
  IngredientPackagingInfo,
  ShoppingList,
  ShoppingListItem,
} from "@/features/production-planning";
import {
  generateProcurementRecommendation,
  generateShoppingList,
  calculateProductionPlan,
  roundUpToPackageQuantity,
  validateShoppingListForProcurement,
} from "@/features/production-planning";

function makeShoppingItem(
  overrides: Partial<ShoppingListItem> &
    Pick<ShoppingListItem, "ingredientId">,
): ShoppingListItem {
  return {
    ingredientName: overrides.ingredientName ?? overrides.ingredientId,
    unit: "kg",
    shortageQuantity: 10,
    currentStock: 0,
    requiredQuantity: 10,
    ...overrides,
  };
}

function makeShoppingList(
  items: readonly ShoppingListItem[],
): ShoppingList {
  const totalMissingQuantity = items.reduce(
    (sum, item) => sum + item.shortageQuantity,
    0,
  );

  return {
    items,
    summary: {
      totalItems: items.length,
      totalMissingQuantity,
      ingredientsToBuy: items.length,
    },
  };
}

describe("roundUpToPackageQuantity", () => {
  it("rounds 12 kg need to a 25 kg package", () => {
    expect(roundUpToPackageQuantity(12, 25)).toEqual({
      packagesToBuy: 1,
      recommendedPurchaseQuantity: 25,
      roundingApplied: true,
    });
  });

  it("rounds 28 kg need to three 10 kg packages", () => {
    expect(roundUpToPackageQuantity(28, 10)).toEqual({
      packagesToBuy: 3,
      recommendedPurchaseQuantity: 30,
      roundingApplied: true,
    });
  });

  it("rounds 51 pcs need to three 24 pcs packages", () => {
    expect(roundUpToPackageQuantity(51, 24)).toEqual({
      packagesToBuy: 3,
      recommendedPurchaseQuantity: 72,
      roundingApplied: true,
    });
  });

  it("keeps an exact package multiple without rounding", () => {
    expect(roundUpToPackageQuantity(50, 25)).toEqual({
      packagesToBuy: 2,
      recommendedPurchaseQuantity: 50,
      roundingApplied: false,
    });
  });

  it("never recommends less than the shortage", () => {
    const result = roundUpToPackageQuantity(7, 3);
    expect(result.recommendedPurchaseQuantity).toBeGreaterThanOrEqual(7);
  });
});

describe("generateProcurementRecommendation", () => {
  it("recommends exact shortage quantity when no packaging exists", () => {
    const shoppingList = makeShoppingList([
      makeShoppingItem({
        ingredientId: "flour",
        ingredientName: "Flour",
        shortageQuantity: 12,
        unit: "kg",
      }),
    ]);

    const output = generateProcurementRecommendation({ shoppingList });

    expect(output.ok).toBe(true);
    if (!output.ok) return;

    expect(output.recommendation.items).toEqual([
      {
        ingredientId: "flour",
        ingredientName: "Flour",
        shortageQuantity: 12,
        recommendedPurchaseQuantity: 12,
        unit: "kg",
        packagesToBuy: 1,
        roundingApplied: false,
        recommendationReason: "NoPackagingData",
      },
    ]);
  });

  it("applies NoPackagingData when packaging entry has no package size", () => {
    const shoppingList = makeShoppingList([
      makeShoppingItem({
        ingredientId: "milk",
        ingredientName: "Milk",
        shortageQuantity: 4,
        unit: "L",
      }),
    ]);

    const packaging: IngredientPackagingInfo[] = [
      {
        ingredientId: "milk",
        supplierId: "supplier-1",
        supplierName: "Dairy Co",
      },
    ];

    const output = generateProcurementRecommendation({
      shoppingList,
      packaging,
    });

    expect(output.ok).toBe(true);
    if (!output.ok) return;

    expect(output.recommendation.items[0]).toMatchObject({
      recommendedPurchaseQuantity: 4,
      supplierId: "supplier-1",
      supplierName: "Dairy Co",
      roundingApplied: false,
      recommendationReason: "NoPackagingData",
    });
  });

  it("rounds up to the nearest package quantity", () => {
    const shoppingList = makeShoppingList([
      makeShoppingItem({
        ingredientId: "flour",
        ingredientName: "Flour",
        shortageQuantity: 12,
        unit: "kg",
      }),
    ]);

    const output = generateProcurementRecommendation({
      shoppingList,
      packaging: [
        {
          ingredientId: "flour",
          packageSize: 25,
          packageUnit: "kg",
        },
      ],
    });

    expect(output.ok).toBe(true);
    if (!output.ok) return;

    expect(output.recommendation.items[0]).toMatchObject({
      shortageQuantity: 12,
      recommendedPurchaseQuantity: 25,
      packageSize: 25,
      packageUnit: "kg",
      packagesToBuy: 1,
      roundingApplied: true,
      recommendationReason: "RoundedToPackage",
    });
  });

  it("supports multiple package sizes across ingredients", () => {
    const shoppingList = makeShoppingList([
      makeShoppingItem({
        ingredientId: "flour",
        ingredientName: "Flour",
        shortageQuantity: 28,
        unit: "kg",
      }),
      makeShoppingItem({
        ingredientId: "eggs",
        ingredientName: "Eggs",
        shortageQuantity: 51,
        unit: "pcs",
        currentStock: 0,
        requiredQuantity: 51,
      }),
    ]);

    const output = generateProcurementRecommendation({
      shoppingList,
      packaging: [
        { ingredientId: "flour", packageSize: 10, packageUnit: "kg" },
        { ingredientId: "eggs", packageSize: 24, packageUnit: "pcs" },
      ],
    });

    expect(output.ok).toBe(true);
    if (!output.ok) return;

    expect(output.recommendation.items).toHaveLength(2);
    expect(output.recommendation.items[0]).toMatchObject({
      ingredientId: "flour",
      recommendedPurchaseQuantity: 30,
      packagesToBuy: 3,
      recommendationReason: "RoundedToPackage",
    });
    expect(output.recommendation.items[1]).toMatchObject({
      ingredientId: "eggs",
      recommendedPurchaseQuantity: 72,
      packagesToBuy: 3,
      recommendationReason: "RoundedToPackage",
    });
  });

  it("uses ExactQuantity when shortage is an exact package multiple", () => {
    const shoppingList = makeShoppingList([
      makeShoppingItem({
        ingredientId: "sugar",
        ingredientName: "Sugar",
        shortageQuantity: 50,
        unit: "kg",
      }),
    ]);

    const output = generateProcurementRecommendation({
      shoppingList,
      packaging: [{ ingredientId: "sugar", packageSize: 25, packageUnit: "kg" }],
    });

    expect(output.ok).toBe(true);
    if (!output.ok) return;

    expect(output.recommendation.items[0]).toMatchObject({
      recommendedPurchaseQuantity: 50,
      packagesToBuy: 2,
      roundingApplied: false,
      recommendationReason: "ExactQuantity",
    });
  });

  it("never recommends less than the shortage quantity", () => {
    const shoppingList = makeShoppingList([
      makeShoppingItem({
        ingredientId: "butter",
        ingredientName: "Butter",
        shortageQuantity: 7,
        unit: "kg",
      }),
    ]);

    const output = generateProcurementRecommendation({
      shoppingList,
      packaging: [{ ingredientId: "butter", packageSize: 3 }],
    });

    expect(output.ok).toBe(true);
    if (!output.ok) return;

    const item = output.recommendation.items[0];
    expect(item.recommendedPurchaseQuantity).toBeGreaterThanOrEqual(
      item.shortageQuantity,
    );
  });

  it("attaches optional supplier metadata without optimizing suppliers", () => {
    const shoppingList = makeShoppingList([
      makeShoppingItem({
        ingredientId: "flour",
        ingredientName: "Flour",
        shortageQuantity: 5,
      }),
    ]);

    const output = generateProcurementRecommendation({
      shoppingList,
      packaging: [
        {
          ingredientId: "flour",
          packageSize: 10,
          packageUnit: "kg",
          supplierId: "sup-a",
          supplierName: "Mill House",
        },
      ],
    });

    expect(output.ok).toBe(true);
    if (!output.ok) return;

    expect(output.recommendation.items[0]).toMatchObject({
      supplierId: "sup-a",
      supplierName: "Mill House",
      recommendationReason: "RoundedToPackage",
    });
  });

  it("builds summary totals from recommendation items", () => {
    const shoppingList = makeShoppingList([
      makeShoppingItem({
        ingredientId: "flour",
        ingredientName: "Flour",
        shortageQuantity: 12,
      }),
      makeShoppingItem({
        ingredientId: "milk",
        ingredientName: "Milk",
        shortageQuantity: 4,
        unit: "L",
      }),
    ]);

    const output = generateProcurementRecommendation({
      shoppingList,
      packaging: [
        { ingredientId: "flour", packageSize: 25 },
        // milk has no packaging → packagesToBuy = 1, qty = 4
      ],
    });

    expect(output.ok).toBe(true);
    if (!output.ok) return;

    expect(output.recommendation.summary).toEqual({
      totalIngredients: 2,
      totalPackages: 2,
      totalPurchaseQuantity: 29,
    });
  });

  it("returns an empty recommendation for an empty shopping list", () => {
    const output = generateProcurementRecommendation({
      shoppingList: makeShoppingList([]),
    });

    expect(output.ok).toBe(true);
    if (!output.ok) return;

    expect(output.recommendation.items).toEqual([]);
    expect(output.recommendation.summary).toEqual({
      totalIngredients: 0,
      totalPackages: 0,
      totalPurchaseQuantity: 0,
    });
  });

  it("is deterministic for the same input", () => {
    const shoppingList = makeShoppingList([
      makeShoppingItem({
        ingredientId: "flour",
        ingredientName: "Flour",
        shortageQuantity: 12,
      }),
    ]);
    const packaging = [{ ingredientId: "flour", packageSize: 25 }];

    const first = generateProcurementRecommendation({ shoppingList, packaging });
    const second = generateProcurementRecommendation({
      shoppingList,
      packaging,
    });

    expect(first).toEqual(second);
  });

  it("does not mutate the shopping list or packaging", () => {
    const shoppingList = makeShoppingList([
      makeShoppingItem({
        ingredientId: "flour",
        ingredientName: "Flour",
        shortageQuantity: 12,
      }),
    ]);
    const packaging: IngredientPackagingInfo[] = [
      { ingredientId: "flour", packageSize: 25 },
    ];
    const listSnapshot = structuredClone(shoppingList);
    const packagingSnapshot = structuredClone(packaging);

    const output = generateProcurementRecommendation({
      shoppingList,
      packaging,
    });

    expect(output.ok).toBe(true);
    expect(shoppingList).toEqual(listSnapshot);
    expect(packaging).toEqual(packagingSnapshot);
  });

  it("rejects duplicate ingredients on the shopping list", () => {
    const shoppingList = makeShoppingList([
      makeShoppingItem({ ingredientId: "flour", shortageQuantity: 2 }),
      makeShoppingItem({ ingredientId: "flour", shortageQuantity: 3 }),
    ]);

    const output = generateProcurementRecommendation({ shoppingList });

    expect(output.ok).toBe(false);
    if (output.ok) return;

    expect(
      output.issues.some((issue) => issue.code === "duplicate_ingredient"),
    ).toBe(true);
  });

  it("rejects an invalid shopping list", () => {
    const output = generateProcurementRecommendation({
      shoppingList: null as unknown as ShoppingList,
    });

    expect(output.ok).toBe(false);
    if (output.ok) return;

    expect(output.issues[0]?.code).toBe("invalid_shopping_list");
  });

  it("rejects zero package size", () => {
    const shoppingList = makeShoppingList([
      makeShoppingItem({ ingredientId: "flour", shortageQuantity: 5 }),
    ]);

    const output = generateProcurementRecommendation({
      shoppingList,
      packaging: [{ ingredientId: "flour", packageSize: 0 }],
    });

    expect(output.ok).toBe(false);
    if (output.ok) return;

    expect(output.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "zero_package_size",
          ingredientId: "flour",
        }),
      ]),
    );
  });

  it("rejects negative package size", () => {
    const shoppingList = makeShoppingList([
      makeShoppingItem({ ingredientId: "flour", shortageQuantity: 5 }),
    ]);

    const output = generateProcurementRecommendation({
      shoppingList,
      packaging: [{ ingredientId: "flour", packageSize: -10 }],
    });

    expect(output.ok).toBe(false);
    if (output.ok) return;

    expect(output.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "negative_package_size",
          ingredientId: "flour",
        }),
      ]),
    );
  });

  it("rejects non-finite package size", () => {
    const shoppingList = makeShoppingList([
      makeShoppingItem({ ingredientId: "flour", shortageQuantity: 5 }),
    ]);

    const output = generateProcurementRecommendation({
      shoppingList,
      packaging: [{ ingredientId: "flour", packageSize: Number.NaN }],
    });

    expect(output.ok).toBe(false);
    if (output.ok) return;

    expect(output.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "invalid_package_size",
          ingredientId: "flour",
        }),
      ]),
    );
  });
});

describe("validateShoppingListForProcurement", () => {
  it("accepts a well-formed shopping list", () => {
    const shoppingList = makeShoppingList([
      makeShoppingItem({ ingredientId: "flour", shortageQuantity: 1 }),
    ]);

    expect(validateShoppingListForProcurement(shoppingList)).toEqual({
      ok: true,
      issues: [],
    });
  });

  it("reports duplicate ingredients", () => {
    const shoppingList = makeShoppingList([
      makeShoppingItem({ ingredientId: "flour", shortageQuantity: 1 }),
      makeShoppingItem({ ingredientId: "flour", shortageQuantity: 2 }),
    ]);

    const validation = validateShoppingListForProcurement(shoppingList);

    expect(validation.ok).toBe(false);
    if (validation.ok) return;

    expect(validation.issues[0]?.code).toBe("duplicate_ingredient");
  });
});

describe("generateProcurementRecommendation + generateShoppingList", () => {
  it("consumes a shopping list produced from the calculation pipeline", () => {
    const calculation = calculateProductionPlan({
      plan: {
        id: "plan-1",
        name: "Morning batch",
        status: "draft",
        plannedDate: "2026-07-20",
        notes: null,
        createdAt: "2026-07-20T08:00:00.000Z",
        updatedAt: "2026-07-20T08:00:00.000Z",
      },
      lines: [
        {
          finishedGoodId: "fg-a",
          recipeId: "recipe-a",
          plannedQuantity: 10,
          unit: "portion",
        },
      ],
      recipes: [
        {
          id: "recipe-a",
          finishedGoodId: "fg-a",
          status: "active",
          yieldQuantity: 10,
          yieldUnit: "portion",
        },
      ],
      recipeIngredients: [
        {
          recipeId: "recipe-a",
          ingredientId: "flour",
          quantityPerYield: 5,
          unit: "kg",
        },
      ],
      inventory: [
        {
          ingredientId: "flour",
          availableQuantity: 1,
          ingredientName: "Flour",
        },
      ],
    });

    expect(calculation.ok).toBe(true);
    if (!calculation.ok) return;

    const shopping = generateShoppingList(calculation.result);
    expect(shopping.ok).toBe(true);
    if (!shopping.ok) return;

    const output = generateProcurementRecommendation({
      shoppingList: shopping.shoppingList,
      packaging: [{ ingredientId: "flour", packageSize: 10, packageUnit: "kg" }],
    });

    expect(output.ok).toBe(true);
    if (!output.ok) return;

    // Shortage is 4 kg → round up to one 10 kg package
    expect(output.recommendation.items).toEqual([
      {
        ingredientId: "flour",
        ingredientName: "Flour",
        shortageQuantity: 4,
        recommendedPurchaseQuantity: 10,
        unit: "kg",
        packageSize: 10,
        packageUnit: "kg",
        packagesToBuy: 1,
        roundingApplied: true,
        recommendationReason: "RoundedToPackage",
      },
    ]);
    expect(output.recommendation.summary).toEqual({
      totalIngredients: 1,
      totalPackages: 1,
      totalPurchaseQuantity: 10,
    });
  });
});
