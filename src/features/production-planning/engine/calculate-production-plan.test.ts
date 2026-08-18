import { describe, expect, it } from "vitest";

import {
  calculateProductionPlan,
  createProductionPlanningCalculator,
  type CalculateProductionPlanInput,
  type PlanningInventoryItem,
  type PlanningRecipe,
  type PlanningRecipeIngredientLine,
  type ProductionPlan,
  type ProductionPlanLine,
} from "@/features/production-planning";

function makePlan(
  overrides: Partial<ProductionPlan> = {},
): ProductionPlan {
  return {
    id: "plan-1",
    name: "Morning batch",
    status: "draft",
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

function makeRecipe(
  overrides: Partial<PlanningRecipe> & Pick<PlanningRecipe, "id" | "finishedGoodId">,
): PlanningRecipe {
  return {
    status: "active",
    yieldQuantity: 10,
    yieldUnit: "portion",
    recipeRole: "component",
    ...overrides,
  };
}

function makeIngredient(
  overrides: PlanningRecipeIngredientLine,
): PlanningRecipeIngredientLine {
  return overrides;
}

function makeInventory(
  items: Array<[string, number]>,
): PlanningInventoryItem[] {
  return items.map(([ingredientId, availableQuantity]) => ({
    ingredientId,
    availableQuantity,
  }));
}

function baseInput(
  overrides: Partial<CalculateProductionPlanInput> = {},
): CalculateProductionPlanInput {
  const recipes: PlanningRecipe[] = [
    makeRecipe({ id: "recipe-a", finishedGoodId: "fg-a" }),
  ];
  const recipeIngredients: PlanningRecipeIngredientLine[] = [
    makeIngredient({
      recipeId: "recipe-a",
      ingredientId: "flour",
      quantityPerYield: 2,
      unit: "kg",
    }),
  ];
  const lines: ProductionPlanLine[] = [
    makeLine({ finishedGoodId: "fg-a", recipeId: "recipe-a", plannedQuantity: 10 }),
  ];

  return {
    plan: makePlan(),
    lines,
    recipes,
    recipeIngredients,
    inventory: makeInventory([["flour", 100]]),
    ...overrides,
  };
}

describe("calculateProductionPlan", () => {
  it("calculates a single product with no shortages", () => {
    const output = calculateProductionPlan(baseInput());

    expect(output.ok).toBe(true);
    if (!output.ok) return;

    expect(output.result.ingredientRequirements).toHaveLength(1);
    expect(output.result.ingredientRequirements[0]).toMatchObject({
      ingredientId: "flour",
      requiredQuantity: 2,
      availableQuantity: 100,
      shortageQuantity: 0,
      unit: "kg",
    });
    expect(output.result.summary).toMatchObject({
      lineCount: 1,
      ingredientCount: 1,
      availableIngredientCount: 1,
      shortageLineCount: 0,
      hasShortages: false,
      isInventorySufficient: true,
      status: "ready_for_production",
      totalRequiredQuantity: 2,
      totalShortageQuantity: 0,
    });
    expect(output.result.plan.status).toBe("ready_for_production");
  });

  it("calculates multiple products", () => {
    const output = calculateProductionPlan(
      baseInput({
        recipes: [
          makeRecipe({ id: "recipe-a", finishedGoodId: "fg-a" }),
          makeRecipe({ id: "recipe-b", finishedGoodId: "fg-b", yieldQuantity: 5 }),
        ],
        recipeIngredients: [
          makeIngredient({
            recipeId: "recipe-a",
            ingredientId: "flour",
            quantityPerYield: 2,
            unit: "kg",
          }),
          makeIngredient({
            recipeId: "recipe-b",
            ingredientId: "milk",
            quantityPerYield: 1,
            unit: "L",
          }),
        ],
        lines: [
          makeLine({ finishedGoodId: "fg-a", recipeId: "recipe-a", plannedQuantity: 10 }),
          makeLine({ finishedGoodId: "fg-b", recipeId: "recipe-b", plannedQuantity: 5 }),
        ],
        inventory: makeInventory([
          ["flour", 100],
          ["milk", 100],
        ]),
      }),
    );

    expect(output.ok).toBe(true);
    if (!output.ok) return;

    expect(output.result.summary.lineCount).toBe(2);
    expect(output.result.summary.ingredientCount).toBe(2);
    expect(output.result.summary.status).toBe("ready_for_production");
  });

  it("aggregates shared ingredients across recipes before inventory comparison", () => {
    const output = calculateProductionPlan(
      baseInput({
        recipes: [
          makeRecipe({ id: "recipe-a", finishedGoodId: "fg-a", yieldQuantity: 1 }),
          makeRecipe({ id: "recipe-b", finishedGoodId: "fg-b", yieldQuantity: 1 }),
        ],
        recipeIngredients: [
          makeIngredient({
            recipeId: "recipe-a",
            ingredientId: "flour",
            quantityPerYield: 2,
            unit: "kg",
          }),
          makeIngredient({
            recipeId: "recipe-b",
            ingredientId: "flour",
            quantityPerYield: 3,
            unit: "kg",
          }),
        ],
        lines: [
          makeLine({ finishedGoodId: "fg-a", recipeId: "recipe-a", plannedQuantity: 1 }),
          makeLine({ finishedGoodId: "fg-b", recipeId: "recipe-b", plannedQuantity: 1 }),
        ],
        inventory: makeInventory([["flour", 10]]),
      }),
    );

    expect(output.ok).toBe(true);
    if (!output.ok) return;

    expect(output.result.ingredientRequirements).toHaveLength(1);
    expect(output.result.ingredientRequirements[0].requiredQuantity).toBe(5);
    expect(output.result.ingredientRequirements[0].shortageQuantity).toBe(0);
  });

  it("rejects aggregation when the same ingredient appears with different units across recipes", () => {
    const output = calculateProductionPlan(
      baseInput({
        recipes: [
          makeRecipe({ id: "recipe-a", finishedGoodId: "fg-a", yieldQuantity: 1 }),
          makeRecipe({ id: "recipe-b", finishedGoodId: "fg-b", yieldQuantity: 1 }),
        ],
        recipeIngredients: [
          makeIngredient({
            recipeId: "recipe-a",
            ingredientId: "flour",
            quantityPerYield: 2,
            unit: "kg",
          }),
          makeIngredient({
            recipeId: "recipe-b",
            ingredientId: "flour",
            quantityPerYield: 500,
            unit: "g",
          }),
        ],
        lines: [
          makeLine({ finishedGoodId: "fg-a", recipeId: "recipe-a", plannedQuantity: 1 }),
          makeLine({ finishedGoodId: "fg-b", recipeId: "recipe-b", plannedQuantity: 1 }),
        ],
        inventory: makeInventory([["flour", 10]]),
      }),
    );

    expect(output.ok).toBe(false);
    if (output.ok) return;

    const issue = output.issues.find(
      (candidate) => candidate.code === "inconsistent_ingredient_unit",
    );
    expect(issue).toBeDefined();
    expect(issue?.ingredientId).toBe("flour");
    expect(issue?.message).toContain('"kg"');
    expect(issue?.message).toContain('"g"');
  });

  it("does not flag ingredients that share the same unit across every recipe (no false positive)", () => {
    // Same setup as "aggregates shared ingredients across recipes" above —
    // both recipes use "kg" for flour, so this must stay ok.
    const output = calculateProductionPlan(
      baseInput({
        recipes: [
          makeRecipe({ id: "recipe-a", finishedGoodId: "fg-a", yieldQuantity: 1 }),
          makeRecipe({ id: "recipe-b", finishedGoodId: "fg-b", yieldQuantity: 1 }),
        ],
        recipeIngredients: [
          makeIngredient({
            recipeId: "recipe-a",
            ingredientId: "flour",
            quantityPerYield: 2,
            unit: "kg",
          }),
          makeIngredient({
            recipeId: "recipe-b",
            ingredientId: "flour",
            quantityPerYield: 3,
            unit: "kg",
          }),
        ],
        lines: [
          makeLine({ finishedGoodId: "fg-a", recipeId: "recipe-a", plannedQuantity: 1 }),
          makeLine({ finishedGoodId: "fg-b", recipeId: "recipe-b", plannedQuantity: 1 }),
        ],
        inventory: makeInventory([["flour", 10]]),
      }),
    );

    expect(output.ok).toBe(true);
  });

  it("reports zero shortages when available equals required", () => {
    const output = calculateProductionPlan(
      baseInput({
        recipes: [
          makeRecipe({ id: "recipe-a", finishedGoodId: "fg-a", yieldQuantity: 1 }),
        ],
        recipeIngredients: [
          makeIngredient({
            recipeId: "recipe-a",
            ingredientId: "flour",
            quantityPerYield: 5,
            unit: "kg",
          }),
        ],
        lines: [
          makeLine({ finishedGoodId: "fg-a", recipeId: "recipe-a", plannedQuantity: 1 }),
        ],
        inventory: makeInventory([["flour", 5]]),
      }),
    );

    expect(output.ok).toBe(true);
    if (!output.ok) return;

    expect(output.result.ingredientRequirements[0].shortageQuantity).toBe(0);
    expect(output.result.summary.status).toBe("ready_for_production");
  });

  it("reports partial shortages and ReadyForPurchase", () => {
    const output = calculateProductionPlan(
      baseInput({
        recipes: [
          makeRecipe({ id: "recipe-a", finishedGoodId: "fg-a", yieldQuantity: 1 }),
        ],
        recipeIngredients: [
          makeIngredient({
            recipeId: "recipe-a",
            ingredientId: "flour",
            quantityPerYield: 5,
            unit: "kg",
          }),
          makeIngredient({
            recipeId: "recipe-a",
            ingredientId: "milk",
            quantityPerYield: 2,
            unit: "L",
          }),
        ],
        lines: [
          makeLine({ finishedGoodId: "fg-a", recipeId: "recipe-a", plannedQuantity: 1 }),
        ],
        inventory: makeInventory([
          ["flour", 2],
          ["milk", 10],
        ]),
      }),
    );

    expect(output.ok).toBe(true);
    if (!output.ok) return;

    const byId = Object.fromEntries(
      output.result.ingredientRequirements.map((row) => [
        row.ingredientId,
        row,
      ]),
    );

    expect(byId.flour.shortageQuantity).toBe(3);
    expect(byId.milk.shortageQuantity).toBe(0);
    expect(output.result.summary).toMatchObject({
      availableIngredientCount: 1,
      shortageLineCount: 1,
      hasShortages: true,
      status: "ready_for_purchase",
      totalShortageQuantity: 3,
    });
    expect(output.result.plan.status).toBe("ready_for_purchase");
  });

  it("reports full shortages when inventory is empty for every ingredient", () => {
    const output = calculateProductionPlan(
      baseInput({
        recipes: [
          makeRecipe({ id: "recipe-a", finishedGoodId: "fg-a", yieldQuantity: 1 }),
        ],
        recipeIngredients: [
          makeIngredient({
            recipeId: "recipe-a",
            ingredientId: "flour",
            quantityPerYield: 4,
            unit: "kg",
          }),
          makeIngredient({
            recipeId: "recipe-a",
            ingredientId: "milk",
            quantityPerYield: 2,
            unit: "L",
          }),
        ],
        lines: [
          makeLine({ finishedGoodId: "fg-a", recipeId: "recipe-a", plannedQuantity: 1 }),
        ],
        inventory: makeInventory([
          ["flour", 0],
          ["milk", 0],
        ]),
      }),
    );

    expect(output.ok).toBe(true);
    if (!output.ok) return;

    expect(output.result.summary.shortageLineCount).toBe(2);
    expect(output.result.summary.availableIngredientCount).toBe(0);
    expect(output.result.summary.totalShortageQuantity).toBe(6);
    expect(output.result.summary.status).toBe("ready_for_purchase");
  });

  it("never returns negative shortage when available exceeds required", () => {
    const output = calculateProductionPlan(
      baseInput({
        inventory: makeInventory([["flour", 999]]),
      }),
    );

    expect(output.ok).toBe(true);
    if (!output.ok) return;

    expect(output.result.ingredientRequirements[0].shortageQuantity).toBe(0);
  });

  it("does not mutate input objects", () => {
    const plan = makePlan({ status: "draft" });
    const lines = [
      makeLine({ finishedGoodId: "fg-a", recipeId: "recipe-a", plannedQuantity: 10 }),
    ];
    const inventory = makeInventory([["flour", 100]]);
    const input = baseInput({ plan, lines, inventory });

    const output = calculateProductionPlan(input);

    expect(output.ok).toBe(true);
    expect(plan.status).toBe("draft");
    expect(lines[0].plannedQuantity).toBe(10);
    expect(inventory[0].availableQuantity).toBe(100);
  });

  it("is deterministic for the same input", () => {
    const input = baseInput();
    const first = calculateProductionPlan(input);
    const second = calculateProductionPlan(input);

    expect(first).toEqual(second);
  });

  it("rejects unknown recipe", () => {
    const output = calculateProductionPlan(
      baseInput({
        recipes: [],
      }),
    );

    expect(output.ok).toBe(false);
    if (output.ok) return;

    expect(output.issues.some((issue) => issue.code === "missing_recipe")).toBe(
      true,
    );
  });

  it("rejects duplicate recipe", () => {
    const output = calculateProductionPlan(
      baseInput({
        recipes: [
          makeRecipe({ id: "recipe-a", finishedGoodId: "fg-a" }),
          makeRecipe({ id: "recipe-a-dup", finishedGoodId: "fg-b" }),
        ],
        recipeIngredients: [
          makeIngredient({
            recipeId: "recipe-a",
            ingredientId: "flour",
            quantityPerYield: 2,
            unit: "kg",
          }),
          makeIngredient({
            recipeId: "recipe-a-dup",
            ingredientId: "flour",
            quantityPerYield: 1,
            unit: "kg",
          }),
        ],
        lines: [
          makeLine({ finishedGoodId: "fg-a", recipeId: "recipe-a" }),
          makeLine({ finishedGoodId: "fg-b", recipeId: "recipe-a" }),
        ],
        inventory: makeInventory([["flour", 100]]),
      }),
    );

    expect(output.ok).toBe(false);
    if (output.ok) return;

    expect(
      output.issues.some((issue) => issue.code === "duplicate_recipe"),
    ).toBe(true);
  });

  it("rejects archived recipe", () => {
    const output = calculateProductionPlan(
      baseInput({
        recipes: [
          makeRecipe({
            id: "recipe-a",
            finishedGoodId: "fg-a",
            status: "archived",
          }),
        ],
      }),
    );

    expect(output.ok).toBe(false);
    if (output.ok) return;

    expect(
      output.issues.some((issue) => issue.code === "archived_recipe"),
    ).toBe(true);
  });

  it("rejects negative planned quantities", () => {
    const output = calculateProductionPlan(
      baseInput({
        lines: [
          makeLine({
            finishedGoodId: "fg-a",
            recipeId: "recipe-a",
            plannedQuantity: -1,
          }),
        ],
      }),
    );

    expect(output.ok).toBe(false);
    if (output.ok) return;

    expect(
      output.issues.some((issue) => issue.code === "negative_quantity"),
    ).toBe(true);
  });

  it("rejects zero planned quantities", () => {
    const output = calculateProductionPlan(
      baseInput({
        lines: [
          makeLine({
            finishedGoodId: "fg-a",
            recipeId: "recipe-a",
            plannedQuantity: 0,
          }),
        ],
      }),
    );

    expect(output.ok).toBe(false);
    if (output.ok) return;

    expect(output.issues.some((issue) => issue.code === "zero_quantity")).toBe(
      true,
    );
  });

  it("rejects missing inventory item", () => {
    const output = calculateProductionPlan(
      baseInput({
        inventory: [],
      }),
    );

    expect(output.ok).toBe(false);
    if (output.ok) return;

    expect(
      output.issues.some((issue) => issue.code === "missing_inventory"),
    ).toBe(true);
  });

  it("rejects duplicate inventory item", () => {
    const output = calculateProductionPlan(
      baseInput({
        inventory: [
          { ingredientId: "flour", availableQuantity: 10 },
          { ingredientId: "flour", availableQuantity: 20 },
        ],
      }),
    );

    expect(output.ok).toBe(false);
    if (output.ok) return;

    expect(
      output.issues.some((issue) => issue.code === "duplicate_inventory"),
    ).toBe(true);
  });

  it("explodes nested component recipe_items into the planned parent BOM", () => {
    const output = calculateProductionPlan(
      baseInput({
        recipes: [
          makeRecipe({
            id: "chicken",
            finishedGoodId: "chicken",
            yieldQuantity: 1,
            yieldUnit: "kg",
          }),
          makeRecipe({
            id: "marinade",
            finishedGoodId: "marinade",
            yieldQuantity: 1,
            yieldUnit: "kg",
          }),
        ],
        recipeIngredients: [
          makeIngredient({
            recipeId: "chicken",
            ingredientId: "breast",
            quantityPerYield: 0.8,
            unit: "kg",
          }),
          makeIngredient({
            recipeId: "marinade",
            ingredientId: "soy",
            quantityPerYield: 0.05,
            unit: "kg",
          }),
        ],
        recipeComponents: [
          {
            parentRecipeId: "chicken",
            componentRecipeId: "marinade",
            ingredientId: null,
            quantityPerYield: 0.2,
            unit: "kg",
          },
        ],
        lines: [
          makeLine({
            finishedGoodId: "chicken",
            recipeId: "chicken",
            plannedQuantity: 1,
            unit: "kg",
          }),
        ],
        inventory: makeInventory([
          ["breast", 10],
          ["soy", 10],
        ]),
      }),
    );

    expect(output.ok).toBe(true);
    if (!output.ok) return;

    const byId = Object.fromEntries(
      output.result.ingredientRequirements.map((row) => [
        row.ingredientId,
        row,
      ]),
    );
    expect(byId.breast.requiredQuantity).toBe(0.8);
    expect(byId.soy.requiredQuantity).toBe(0.01);
    expect(output.result.summary.ingredientCount).toBe(2);
  });

  it("rejects a circular sub-component graph", () => {
    const output = calculateProductionPlan(
      baseInput({
        recipes: [
          makeRecipe({ id: "recipe-a", finishedGoodId: "fg-a", yieldQuantity: 1 }),
          makeRecipe({ id: "recipe-b", finishedGoodId: "fg-b", yieldQuantity: 1 }),
        ],
        recipeIngredients: [
          makeIngredient({
            recipeId: "recipe-a",
            ingredientId: "flour",
            quantityPerYield: 1,
            unit: "kg",
          }),
        ],
        recipeComponents: [
          {
            parentRecipeId: "recipe-a",
            componentRecipeId: "recipe-b",
            ingredientId: null,
            quantityPerYield: 1,
            unit: "kg",
          },
          {
            parentRecipeId: "recipe-b",
            componentRecipeId: "recipe-a",
            ingredientId: null,
            quantityPerYield: 1,
            unit: "kg",
          },
        ],
        lines: [
          makeLine({
            finishedGoodId: "fg-a",
            recipeId: "recipe-a",
            plannedQuantity: 1,
          }),
        ],
        inventory: makeInventory([["flour", 10]]),
      }),
    );

    expect(output.ok).toBe(false);
    if (output.ok) return;
    expect(
      output.issues.some((issue) => issue.code === "circular_recipe_component"),
    ).toBe(true);
  });

  it("exposes the same engine through createProductionPlanningCalculator", () => {
    const calculator = createProductionPlanningCalculator();
    const output = calculator.calculate(baseInput());

    expect(output.ok).toBe(true);
    if (!output.ok) return;
    expect(output.result.summary.status).toBe("ready_for_production");
  });
});
