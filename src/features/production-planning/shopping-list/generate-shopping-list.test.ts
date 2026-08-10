import { describe, expect, it } from "vitest";

import type {
  IngredientRequirement,
  PlanningResult,
  ProductionPlan,
  ProductionPlanLine,
} from "@/features/production-planning";
import {
  calculateProductionPlan,
  generateShoppingList,
  validatePlanningResultForShoppingList,
} from "@/features/production-planning";

function makePlan(
  overrides: Partial<ProductionPlan> = {},
): ProductionPlan {
  return {
    id: "plan-1",
    name: "Morning batch",
    status: "ready_for_purchase",
    plannedDate: "2026-07-20",
    notes: null,
    createdAt: "2026-07-20T08:00:00.000Z",
    updatedAt: "2026-07-20T08:00:00.000Z",
    ...overrides,
  };
}

function makeLine(
  overrides: Partial<ProductionPlanLine> &
    Pick<ProductionPlanLine, "finishedGoodId" | "recipeId">,
): ProductionPlanLine {
  return {
    plannedQuantity: 10,
    unit: "portion",
    ...overrides,
  };
}

function makeRequirement(
  overrides: Partial<IngredientRequirement> &
    Pick<IngredientRequirement, "ingredientId">,
): IngredientRequirement {
  return {
    ingredientName: overrides.ingredientName ?? overrides.ingredientId,
    requiredQuantity: 10,
    availableQuantity: 0,
    shortageQuantity: 10,
    unit: "kg",
    ...overrides,
  };
}

function makePlanningResult(
  requirements: readonly IngredientRequirement[],
  overrides: Partial<PlanningResult> = {},
): PlanningResult {
  const shortageLineCount = requirements.filter(
    (requirement) => requirement.shortageQuantity > 0,
  ).length;
  const totalShortageQuantity = requirements.reduce(
    (sum, requirement) =>
      sum +
      (requirement.shortageQuantity > 0 ? requirement.shortageQuantity : 0),
    0,
  );
  const totalRequiredQuantity = requirements.reduce(
    (sum, requirement) => sum + requirement.requiredQuantity,
    0,
  );
  const hasShortages = shortageLineCount > 0;

  return {
    plan: makePlan({
      status: hasShortages ? "ready_for_purchase" : "ready_for_production",
    }),
    lines: [
      makeLine({ finishedGoodId: "fg-a", recipeId: "recipe-a" }),
    ],
    ingredientRequirements: requirements,
    summary: {
      lineCount: 1,
      ingredientCount: requirements.length,
      availableIngredientCount: requirements.length - shortageLineCount,
      shortageLineCount,
      totalPlannedQuantity: 10,
      totalRequiredQuantity,
      totalShortageQuantity,
      hasShortages,
      isInventorySufficient: !hasShortages,
      status: hasShortages ? "ready_for_purchase" : "ready_for_production",
    },
    ...overrides,
  };
}

describe("generateShoppingList", () => {
  it("returns an empty shopping list when there are no shortages", () => {
    const result = makePlanningResult([
      makeRequirement({
        ingredientId: "flour",
        ingredientName: "Flour",
        requiredQuantity: 5,
        availableQuantity: 20,
        shortageQuantity: 0,
      }),
    ]);

    const output = generateShoppingList(result);

    expect(output.ok).toBe(true);
    if (!output.ok) return;

    expect(output.shoppingList.items).toEqual([]);
    expect(output.shoppingList.summary).toEqual({
      totalItems: 0,
      totalMissingQuantity: 0,
      ingredientsToBuy: 0,
    });
  });

  it("includes a single shortage item", () => {
    const result = makePlanningResult([
      makeRequirement({
        ingredientId: "flour",
        ingredientName: "Flour",
        requiredQuantity: 12,
        availableQuantity: 5,
        shortageQuantity: 7,
        unit: "kg",
      }),
    ]);

    const output = generateShoppingList(result);

    expect(output.ok).toBe(true);
    if (!output.ok) return;

    expect(output.shoppingList.items).toEqual([
      {
        ingredientId: "flour",
        ingredientName: "Flour",
        unit: "kg",
        shortageQuantity: 7,
        currentStock: 5,
        requiredQuantity: 12,
      },
    ]);
    expect(output.shoppingList.summary).toEqual({
      totalItems: 1,
      totalMissingQuantity: 7,
      ingredientsToBuy: 1,
    });
  });

  it("includes multiple shortages in input order", () => {
    const result = makePlanningResult([
      makeRequirement({
        ingredientId: "flour",
        ingredientName: "Flour",
        requiredQuantity: 10,
        availableQuantity: 2,
        shortageQuantity: 8,
        unit: "kg",
      }),
      makeRequirement({
        ingredientId: "milk",
        ingredientName: "Milk",
        requiredQuantity: 6,
        availableQuantity: 6,
        shortageQuantity: 0,
        unit: "L",
      }),
      makeRequirement({
        ingredientId: "eggs",
        ingredientName: "Eggs",
        requiredQuantity: 24,
        availableQuantity: 10,
        shortageQuantity: 14,
        unit: "pcs",
      }),
    ]);

    const output = generateShoppingList(result);

    expect(output.ok).toBe(true);
    if (!output.ok) return;

    expect(output.shoppingList.items).toHaveLength(2);
    expect(output.shoppingList.items.map((item) => item.ingredientId)).toEqual([
      "flour",
      "eggs",
    ]);
    expect(output.shoppingList.items[0]).toMatchObject({
      ingredientName: "Flour",
      shortageQuantity: 8,
      currentStock: 2,
      requiredQuantity: 10,
      unit: "kg",
    });
    expect(output.shoppingList.items[1]).toMatchObject({
      ingredientName: "Eggs",
      shortageQuantity: 14,
      currentStock: 10,
      requiredQuantity: 24,
      unit: "pcs",
    });
    expect(output.shoppingList.summary).toEqual({
      totalItems: 2,
      totalMissingQuantity: 22,
      ingredientsToBuy: 2,
    });
  });

  it("excludes zero-shortage ingredients", () => {
    const result = makePlanningResult([
      makeRequirement({
        ingredientId: "flour",
        ingredientName: "Flour",
        shortageQuantity: 0,
        availableQuantity: 100,
        requiredQuantity: 5,
      }),
      makeRequirement({
        ingredientId: "butter",
        ingredientName: "Butter",
        shortageQuantity: 3,
        availableQuantity: 1,
        requiredQuantity: 4,
        unit: "kg",
      }),
    ]);

    const output = generateShoppingList(result);

    expect(output.ok).toBe(true);
    if (!output.ok) return;

    expect(output.shoppingList.items).toHaveLength(1);
    expect(output.shoppingList.items[0].ingredientId).toBe("butter");
    expect(
      output.shoppingList.items.some((item) => item.shortageQuantity === 0),
    ).toBe(false);
  });

  it("builds summary totals from shortage items only", () => {
    const result = makePlanningResult([
      makeRequirement({
        ingredientId: "a",
        ingredientName: "A",
        shortageQuantity: 1.5,
        availableQuantity: 0,
        requiredQuantity: 1.5,
      }),
      makeRequirement({
        ingredientId: "b",
        ingredientName: "B",
        shortageQuantity: 0,
        availableQuantity: 10,
        requiredQuantity: 2,
      }),
      makeRequirement({
        ingredientId: "c",
        ingredientName: "C",
        shortageQuantity: 2.5,
        availableQuantity: 1,
        requiredQuantity: 3.5,
      }),
    ]);

    const output = generateShoppingList(result);

    expect(output.ok).toBe(true);
    if (!output.ok) return;

    expect(output.shoppingList.summary).toEqual({
      totalItems: 2,
      totalMissingQuantity: 4,
      ingredientsToBuy: 2,
    });
  });

  it("is deterministic for the same planning result", () => {
    const result = makePlanningResult([
      makeRequirement({
        ingredientId: "flour",
        ingredientName: "Flour",
        shortageQuantity: 4,
        availableQuantity: 1,
        requiredQuantity: 5,
      }),
      makeRequirement({
        ingredientId: "milk",
        ingredientName: "Milk",
        shortageQuantity: 2,
        availableQuantity: 0,
        requiredQuantity: 2,
        unit: "L",
      }),
    ]);

    const first = generateShoppingList(result);
    const second = generateShoppingList(result);

    expect(first).toEqual(second);
  });

  it("does not mutate the planning result", () => {
    const requirements = [
      makeRequirement({
        ingredientId: "flour",
        ingredientName: "Flour",
        shortageQuantity: 4,
        availableQuantity: 1,
        requiredQuantity: 5,
      }),
      makeRequirement({
        ingredientId: "milk",
        ingredientName: "Milk",
        shortageQuantity: 0,
        availableQuantity: 8,
        requiredQuantity: 2,
        unit: "L",
      }),
    ];
    const result = makePlanningResult(requirements);
    const snapshot = structuredClone(result);

    const output = generateShoppingList(result);

    expect(output.ok).toBe(true);
    expect(result).toEqual(snapshot);
    expect(result.ingredientRequirements).toHaveLength(2);
  });

  it("rejects duplicate ingredient entries", () => {
    const result = makePlanningResult([
      makeRequirement({
        ingredientId: "flour",
        ingredientName: "Flour",
        shortageQuantity: 2,
      }),
      makeRequirement({
        ingredientId: "flour",
        ingredientName: "Flour duplicate",
        shortageQuantity: 3,
      }),
    ]);

    const output = generateShoppingList(result);

    expect(output.ok).toBe(false);
    if (output.ok) return;

    expect(output.issues.some((issue) => issue.code === "duplicate_ingredient")).toBe(
      true,
    );
  });

  it("rejects negative shortages", () => {
    const result = makePlanningResult([
      makeRequirement({
        ingredientId: "flour",
        ingredientName: "Flour",
        shortageQuantity: -1,
        availableQuantity: 10,
        requiredQuantity: 5,
      }),
    ]);

    const output = generateShoppingList(result);

    expect(output.ok).toBe(false);
    if (output.ok) return;

    expect(output.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "negative_shortage",
          ingredientId: "flour",
        }),
      ]),
    );
  });

  it("rejects an invalid planning result", () => {
    const output = generateShoppingList(
      null as unknown as PlanningResult,
    );

    expect(output.ok).toBe(false);
    if (output.ok) return;

    expect(output.issues[0]?.code).toBe("invalid_planning_result");
  });
});

describe("validatePlanningResultForShoppingList", () => {
  it("accepts a well-formed planning result", () => {
    const result = makePlanningResult([
      makeRequirement({
        ingredientId: "flour",
        ingredientName: "Flour",
        shortageQuantity: 1,
      }),
    ]);

    expect(validatePlanningResultForShoppingList(result)).toEqual({
      ok: true,
      issues: [],
    });
  });

  it("reports duplicate ingredients", () => {
    const result = makePlanningResult([
      makeRequirement({ ingredientId: "flour", shortageQuantity: 1 }),
      makeRequirement({ ingredientId: "flour", shortageQuantity: 2 }),
    ]);

    const validation = validatePlanningResultForShoppingList(result);

    expect(validation.ok).toBe(false);
    if (validation.ok) return;

    expect(validation.issues[0]?.code).toBe("duplicate_ingredient");
  });
});

describe("generateShoppingList + calculateProductionPlan", () => {
  it("consumes a calculation engine result for shortages only", () => {
    const calculation = calculateProductionPlan({
      plan: makePlan({ status: "draft" }),
      lines: [
        makeLine({
          finishedGoodId: "fg-a",
          recipeId: "recipe-a",
          plannedQuantity: 10,
        }),
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
        {
          recipeId: "recipe-a",
          ingredientId: "milk",
          quantityPerYield: 2,
          unit: "L",
        },
      ],
      inventory: [
        {
          ingredientId: "flour",
          availableQuantity: 1,
          ingredientName: "Flour",
        },
        {
          ingredientId: "milk",
          availableQuantity: 100,
          ingredientName: "Milk",
        },
      ],
    });

    expect(calculation.ok).toBe(true);
    if (!calculation.ok) return;

    const output = generateShoppingList(calculation.result);

    expect(output.ok).toBe(true);
    if (!output.ok) return;

    expect(output.shoppingList.items).toEqual([
      {
        ingredientId: "flour",
        ingredientName: "Flour",
        unit: "kg",
        shortageQuantity: 4,
        currentStock: 1,
        requiredQuantity: 5,
      },
    ]);
    expect(output.shoppingList.summary).toEqual({
      totalItems: 1,
      totalMissingQuantity: 4,
      ingredientsToBuy: 1,
    });
  });
});
