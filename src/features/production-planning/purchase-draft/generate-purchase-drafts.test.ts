import { describe, expect, it } from "vitest";

import type {
  ProcurementRecommendation,
  ProcurementRecommendationItem,
  ShoppingList,
  ShoppingListItem,
} from "@/features/production-planning";
import {
  generateProcurementRecommendation,
  generatePurchaseDrafts,
  generateShoppingList,
  calculateProductionPlan,
  validateProcurementRecommendationForDraft,
} from "@/features/production-planning";

function makeRecommendationItem(
  overrides: Partial<ProcurementRecommendationItem> &
    Pick<ProcurementRecommendationItem, "ingredientId">,
): ProcurementRecommendationItem {
  return {
    ingredientName: overrides.ingredientName ?? overrides.ingredientId,
    shortageQuantity: overrides.shortageQuantity ?? 10,
    recommendedPurchaseQuantity: overrides.recommendedPurchaseQuantity ?? 10,
    unit: overrides.unit ?? "kg",
    packagesToBuy: overrides.packagesToBuy ?? 1,
    roundingApplied: overrides.roundingApplied ?? false,
    recommendationReason: overrides.recommendationReason ?? "NoPackagingData",
    ...overrides,
  };
}

function makeRecommendation(
  items: readonly ProcurementRecommendationItem[],
): ProcurementRecommendation {
  const totalPackages = items.reduce((sum, item) => sum + item.packagesToBuy, 0);
  const totalPurchaseQuantity = items.reduce(
    (sum, item) => sum + item.recommendedPurchaseQuantity,
    0,
  );

  return {
    items,
    summary: {
      totalIngredients: items.length,
      totalPackages,
      totalPurchaseQuantity,
    },
  };
}

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

describe("generatePurchaseDrafts", () => {
  it("creates a single draft when supplier information is unavailable", () => {
    const recommendation = makeRecommendation([
      makeRecommendationItem({
        ingredientId: "flour",
        ingredientName: "Flour",
        recommendedPurchaseQuantity: 25,
        packagesToBuy: 1,
        packageSize: 25,
        recommendationReason: "RoundedToPackage",
      }),
      makeRecommendationItem({
        ingredientId: "milk",
        ingredientName: "Milk",
        recommendedPurchaseQuantity: 4,
        unit: "L",
        packagesToBuy: 1,
        recommendationReason: "NoPackagingData",
      }),
    ]);

    const output = generatePurchaseDrafts({ recommendation });

    expect(output.ok).toBe(true);
    if (!output.ok) return;

    expect(output.collection.drafts).toHaveLength(1);
    expect(output.collection.drafts[0]).toMatchObject({
      draftId: "purchase-draft-unassigned",
      status: "Draft",
      notes: "",
      lines: [
        {
          ingredientId: "flour",
          ingredientName: "Flour",
          recommendedPurchaseQuantity: 25,
          unit: "kg",
          packageSize: 25,
          packagesToBuy: 1,
          recommendationReason: "RoundedToPackage",
        },
        {
          ingredientId: "milk",
          ingredientName: "Milk",
          recommendedPurchaseQuantity: 4,
          unit: "L",
          packagesToBuy: 1,
          recommendationReason: "NoPackagingData",
        },
      ],
    });
    expect(output.collection.drafts[0].supplierId).toBeUndefined();
    expect(output.collection.drafts[0].supplierName).toBeUndefined();
  });

  it("groups lines into one draft per supplier when supplier metadata exists", () => {
    const recommendation = makeRecommendation([
      makeRecommendationItem({
        ingredientId: "flour",
        ingredientName: "Flour",
        recommendedPurchaseQuantity: 25,
        supplierId: "sup-mill",
        supplierName: "Mill House",
        packageSize: 25,
        packagesToBuy: 1,
        recommendationReason: "RoundedToPackage",
      }),
      makeRecommendationItem({
        ingredientId: "milk",
        ingredientName: "Milk",
        recommendedPurchaseQuantity: 10,
        unit: "L",
        supplierId: "sup-dairy",
        supplierName: "Dairy Co",
        packageSize: 10,
        packagesToBuy: 1,
        recommendationReason: "ExactQuantity",
      }),
      makeRecommendationItem({
        ingredientId: "sugar",
        ingredientName: "Sugar",
        recommendedPurchaseQuantity: 50,
        supplierId: "sup-mill",
        supplierName: "Mill House",
        packageSize: 25,
        packagesToBuy: 2,
        recommendationReason: "ExactQuantity",
      }),
    ]);

    const output = generatePurchaseDrafts({ recommendation });

    expect(output.ok).toBe(true);
    if (!output.ok) return;

    expect(output.collection.drafts).toHaveLength(2);

    expect(output.collection.drafts[0]).toMatchObject({
      draftId: "purchase-draft-sup-mill",
      supplierId: "sup-mill",
      supplierName: "Mill House",
      status: "Draft",
      lines: [
        expect.objectContaining({ ingredientId: "flour" }),
        expect.objectContaining({ ingredientId: "sugar" }),
      ],
    });

    expect(output.collection.drafts[1]).toMatchObject({
      draftId: "purchase-draft-sup-dairy",
      supplierId: "sup-dairy",
      supplierName: "Dairy Co",
      status: "Draft",
      lines: [expect.objectContaining({ ingredientId: "milk" })],
    });
  });

  it("places unassigned lines in a separate draft when mixed with suppliers", () => {
    const recommendation = makeRecommendation([
      makeRecommendationItem({
        ingredientId: "flour",
        supplierId: "sup-mill",
        supplierName: "Mill House",
        recommendedPurchaseQuantity: 10,
      }),
      makeRecommendationItem({
        ingredientId: "eggs",
        recommendedPurchaseQuantity: 24,
        unit: "pcs",
      }),
    ]);

    const output = generatePurchaseDrafts({ recommendation });

    expect(output.ok).toBe(true);
    if (!output.ok) return;

    expect(output.collection.drafts).toHaveLength(2);
    expect(output.collection.drafts[0].draftId).toBe("purchase-draft-sup-mill");
    expect(output.collection.drafts[1].draftId).toBe(
      "purchase-draft-unassigned",
    );
    expect(output.collection.drafts[1].lines[0]?.ingredientId).toBe("eggs");
  });

  it("builds collection summary totals", () => {
    const recommendation = makeRecommendation([
      makeRecommendationItem({
        ingredientId: "flour",
        recommendedPurchaseQuantity: 25,
        supplierId: "sup-a",
        supplierName: "A",
      }),
      makeRecommendationItem({
        ingredientId: "milk",
        recommendedPurchaseQuantity: 4,
        unit: "L",
        supplierId: "sup-b",
        supplierName: "B",
      }),
    ]);

    const output = generatePurchaseDrafts({ recommendation });

    expect(output.ok).toBe(true);
    if (!output.ok) return;

    expect(output.collection.summary).toEqual({
      totalDrafts: 2,
      totalLines: 2,
      totalPurchaseQuantity: 29,
    });
  });

  it("copies optional notes and planned delivery date onto every draft", () => {
    const recommendation = makeRecommendation([
      makeRecommendationItem({
        ingredientId: "flour",
        supplierId: "sup-a",
        supplierName: "A",
      }),
      makeRecommendationItem({
        ingredientId: "milk",
        supplierId: "sup-b",
        supplierName: "B",
        unit: "L",
      }),
    ]);

    const output = generatePurchaseDrafts({
      recommendation,
      notes: "From morning plan",
      plannedDeliveryDate: "2026-07-22",
    });

    expect(output.ok).toBe(true);
    if (!output.ok) return;

    for (const draft of output.collection.drafts) {
      expect(draft.notes).toBe("From morning plan");
      expect(draft.plannedDeliveryDate).toBe("2026-07-22");
      expect(draft.status).toBe("Draft");
    }
  });

  it("does not include pricing fields on draft lines", () => {
    const recommendation = makeRecommendation([
      makeRecommendationItem({
        ingredientId: "flour",
        recommendedPurchaseQuantity: 10,
      }),
    ]);

    const output = generatePurchaseDrafts({ recommendation });

    expect(output.ok).toBe(true);
    if (!output.ok) return;

    const line = output.collection.drafts[0].lines[0] as unknown as Record<
      string,
      unknown
    >;
    expect(line).not.toHaveProperty("unitPrice");
    expect(line).not.toHaveProperty("lineTotal");
    expect(line).not.toHaveProperty("estimatedCost");
    expect(line).not.toHaveProperty("price");
  });

  it("is deterministic for the same input", () => {
    const recommendation = makeRecommendation([
      makeRecommendationItem({
        ingredientId: "flour",
        supplierId: "sup-a",
        supplierName: "A",
      }),
      makeRecommendationItem({
        ingredientId: "milk",
        supplierId: "sup-b",
        supplierName: "B",
        unit: "L",
      }),
    ]);

    const first = generatePurchaseDrafts({ recommendation });
    const second = generatePurchaseDrafts({ recommendation });

    expect(first).toEqual(second);
  });

  it("does not mutate the recommendation", () => {
    const recommendation = makeRecommendation([
      makeRecommendationItem({
        ingredientId: "flour",
        recommendedPurchaseQuantity: 12,
      }),
    ]);
    const snapshot = structuredClone(recommendation);

    const output = generatePurchaseDrafts({ recommendation });

    expect(output.ok).toBe(true);
    expect(recommendation).toEqual(snapshot);
  });

  it("rejects an empty recommendation", () => {
    const output = generatePurchaseDrafts({
      recommendation: makeRecommendation([]),
    });

    expect(output.ok).toBe(false);
    if (output.ok) return;

    expect(output.issues[0]?.code).toBe("empty_procurement_recommendation");
  });

  it("rejects duplicate recommendation items", () => {
    const recommendation = makeRecommendation([
      makeRecommendationItem({ ingredientId: "flour", recommendedPurchaseQuantity: 2 }),
      makeRecommendationItem({ ingredientId: "flour", recommendedPurchaseQuantity: 3 }),
    ]);

    const output = generatePurchaseDrafts({ recommendation });

    expect(output.ok).toBe(false);
    if (output.ok) return;

    expect(
      output.issues.some((issue) => issue.code === "duplicate_ingredient"),
    ).toBe(true);
  });

  it("rejects invalid recommended purchase quantities", () => {
    const cases: Array<{
      label: string;
      quantity: number;
      expectedCode: string;
    }> = [
      { label: "NaN", quantity: Number.NaN, expectedCode: "invalid_quantity" },
      { label: "negative", quantity: -5, expectedCode: "negative_quantity" },
      { label: "zero", quantity: 0, expectedCode: "zero_quantity" },
    ];

    for (const testCase of cases) {
      const output = generatePurchaseDrafts({
        recommendation: makeRecommendation([
          makeRecommendationItem({
            ingredientId: "flour",
            recommendedPurchaseQuantity: testCase.quantity,
          }),
        ]),
      });

      expect(output.ok, testCase.label).toBe(false);
      if (output.ok) return;

      expect(
        output.issues.some((issue) => issue.code === testCase.expectedCode),
        testCase.label,
      ).toBe(true);
    }
  });

  it("rejects invalid packagesToBuy values", () => {
    const output = generatePurchaseDrafts({
      recommendation: makeRecommendation([
        makeRecommendationItem({
          ingredientId: "flour",
          packagesToBuy: 1.5,
        }),
      ]),
    });

    expect(output.ok).toBe(false);
    if (output.ok) return;

    expect(output.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "invalid_quantity",
          field: "items[0].packagesToBuy",
        }),
      ]),
    );
  });

  it("rejects an invalid recommendation shape", () => {
    const output = generatePurchaseDrafts({
      recommendation: null as unknown as ProcurementRecommendation,
    });

    expect(output.ok).toBe(false);
    if (output.ok) return;

    expect(output.issues[0]?.code).toBe("invalid_procurement_recommendation");
  });
});

describe("validateProcurementRecommendationForDraft", () => {
  it("accepts a well-formed recommendation", () => {
    const recommendation = makeRecommendation([
      makeRecommendationItem({ ingredientId: "flour" }),
    ]);

    expect(validateProcurementRecommendationForDraft(recommendation)).toEqual({
      ok: true,
      issues: [],
    });
  });

  it("reports empty recommendations", () => {
    const validation = validateProcurementRecommendationForDraft(
      makeRecommendation([]),
    );

    expect(validation.ok).toBe(false);
    if (validation.ok) return;

    expect(validation.issues[0]?.code).toBe("empty_procurement_recommendation");
  });

  it("reports duplicate ingredients", () => {
    const validation = validateProcurementRecommendationForDraft(
      makeRecommendation([
        makeRecommendationItem({ ingredientId: "flour" }),
        makeRecommendationItem({ ingredientId: "flour" }),
      ]),
    );

    expect(validation.ok).toBe(false);
    if (validation.ok) return;

    expect(validation.issues[0]?.code).toBe("duplicate_ingredient");
  });
});

describe("pipeline: calculation → shopping → procurement → purchase drafts", () => {
  it("builds drafts from a full planning pipeline recommendation", () => {
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

    const procurement = generateProcurementRecommendation({
      shoppingList: shopping.shoppingList,
      packaging: [
        {
          ingredientId: "flour",
          packageSize: 10,
          packageUnit: "kg",
          supplierId: "sup-mill",
          supplierName: "Mill House",
        },
      ],
    });

    expect(procurement.ok).toBe(true);
    if (!procurement.ok) return;

    const drafts = generatePurchaseDrafts({
      recommendation: procurement.recommendation,
      notes: "Auto from plan-1",
    });

    expect(drafts.ok).toBe(true);
    if (!drafts.ok) return;

    expect(drafts.collection.drafts).toEqual([
      {
        draftId: "purchase-draft-sup-mill",
        supplierId: "sup-mill",
        supplierName: "Mill House",
        notes: "Auto from plan-1",
        status: "Draft",
        lines: [
          {
            ingredientId: "flour",
            ingredientName: "Flour",
            recommendedPurchaseQuantity: 10,
            unit: "kg",
            packageSize: 10,
            packagesToBuy: 1,
            recommendationReason: "RoundedToPackage",
          },
        ],
      },
    ]);
    expect(drafts.collection.summary).toEqual({
      totalDrafts: 1,
      totalLines: 1,
      totalPurchaseQuantity: 10,
    });
  });

  it("builds a single unassigned draft from packaging-free procurement", () => {
    const shoppingList = makeShoppingList([
      makeShoppingItem({
        ingredientId: "flour",
        ingredientName: "Flour",
        shortageQuantity: 12,
      }),
    ]);

    const procurement = generateProcurementRecommendation({ shoppingList });
    expect(procurement.ok).toBe(true);
    if (!procurement.ok) return;

    const drafts = generatePurchaseDrafts({
      recommendation: procurement.recommendation,
    });

    expect(drafts.ok).toBe(true);
    if (!drafts.ok) return;

    expect(drafts.collection.drafts).toHaveLength(1);
    expect(drafts.collection.drafts[0].draftId).toBe(
      "purchase-draft-unassigned",
    );
    expect(drafts.collection.drafts[0].lines[0]).toMatchObject({
      ingredientId: "flour",
      recommendedPurchaseQuantity: 12,
      recommendationReason: "NoPackagingData",
    });
  });
});
