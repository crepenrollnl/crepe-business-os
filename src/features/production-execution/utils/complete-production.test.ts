import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertCanCompleteProductionSession,
  buildCompleteProductionPlan,
  formatZeroCostConsumptionWarning,
  listZeroUnitCostConsumptions,
  logProductionCompleted,
  mapCompleteProductionRpcError,
  validateInventoryForCompletion,
  type CompleteProductionRecipeBom,
} from "./complete-production";

function bom(
  overrides?: Partial<CompleteProductionRecipeBom>,
): CompleteProductionRecipeBom {
  return {
    recipe_id: "recipe-1",
    recipe_name: "Chicken Crepe",
    yield_quantity: 10,
    is_active: true,
    ingredients: [
      {
        ingredient_id: "flour",
        quantity_per_yield: 2,
        unit: "kg",
        cost_per_unit: 1.5,
        name: "Flour",
        current_stock: 100,
      },
      {
        ingredient_id: "milk",
        quantity_per_yield: 1,
        unit: "l",
        cost_per_unit: 2,
        name: "Milk",
        current_stock: 50,
      },
    ],
    ...overrides,
  };
}

describe("assertCanCompleteProductionSession", () => {
  it("allows only IN_PROGRESS sessions", () => {
    expect(assertCanCompleteProductionSession("in_progress")).toBeNull();
  });

  it("rejects completed sessions (double completion)", () => {
    expect(assertCanCompleteProductionSession("completed")).toBe(
      "This production session is already completed.",
    );
  });

  it("rejects cancelled and non-in-progress statuses", () => {
    expect(assertCanCompleteProductionSession("cancelled")).toBe(
      "This production session was cancelled.",
    );
    expect(assertCanCompleteProductionSession("ready")).toBe(
      "Only in-progress production sessions can be completed.",
    );
  });
});

describe("buildCompleteProductionPlan", () => {
  it("scales consumption by actual produced quantity, not planned", () => {
    const result = buildCompleteProductionPlan(
      [
        {
          line_id: "line-1",
          recipe_id: "recipe-1",
          product_name: "Chicken Crepe",
          actual_produced_quantity: 5,
        },
      ],
      new Map([["recipe-1", bom()]]),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    // yield 10 → actual 5 → scale 0.5 → flour 1, milk 0.5
    expect(result.plan.consumptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ingredient_id: "flour",
          quantity: 1,
        }),
        expect.objectContaining({
          ingredient_id: "milk",
          quantity: 0.5,
        }),
      ]),
    );

    expect(result.plan.batches).toHaveLength(1);
    expect(result.plan.batches[0]).toMatchObject({
      produced_quantity: 5,
      // (1 * 1.5) + (0.5 * 2) = 2.5 → unit cost 0.5
      unit_cost: 0.5,
      total_cost: 2.5,
    });
  });

  it("computes unit cost as total cost / actual produced quantity", () => {
    const result = buildCompleteProductionPlan(
      [
        {
          line_id: "line-1",
          recipe_id: "recipe-1",
          product_name: "Chicken Crepe",
          actual_produced_quantity: 10,
        },
      ],
      new Map([["recipe-1", bom()]]),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    // flour 2 * 1.5 + milk 1 * 2 = 5 → unit cost 0.5
    expect(result.plan.total_cost).toBe(5);
    expect(result.plan.batches[0]?.unit_cost).toBe(0.5);
  });

  it("uses raw_material_scale for consumption when set, not produced/yield", () => {
    const result = buildCompleteProductionPlan(
      [
        {
          line_id: "line-1",
          recipe_id: "recipe-1",
          product_name: "Chicken Crepe",
          actual_produced_quantity: 5,
          raw_material_scale: 1,
        },
      ],
      new Map([["recipe-1", bom()]]),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    // yield 10, produced 5, but scale override 1 → full BOM (flour 2, milk 1)
    expect(
      result.plan.consumptions.find((line) => line.ingredient_id === "flour")
        ?.quantity,
    ).toBe(2);
    expect(
      result.plan.consumptions.find((line) => line.ingredient_id === "milk")
        ?.quantity,
    ).toBe(1);
    expect(result.plan.batches[0]).toMatchObject({
      produced_quantity: 5,
      // (2 * 1.5) + (1 * 2) = 5 → unit cost 1
      unit_cost: 1,
      total_cost: 5,
    });
  });

  it("skips zero actual lines and aggregates shared ingredients", () => {
    const result = buildCompleteProductionPlan(
      [
        {
          line_id: "line-1",
          recipe_id: "recipe-1",
          product_name: "Chicken Crepe",
          actual_produced_quantity: 10,
        },
        {
          line_id: "line-2",
          recipe_id: "recipe-1",
          product_name: "Chicken Crepe",
          actual_produced_quantity: 0,
        },
      ],
      new Map([["recipe-1", bom()]]),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.plan.batches).toHaveLength(1);
    expect(
      result.plan.consumptions.find((line) => line.ingredient_id === "flour")
        ?.quantity,
    ).toBe(2);
  });

  it("rejects inactive recipes and empty BOMs", () => {
    expect(
      buildCompleteProductionPlan(
        [
          {
            line_id: "line-1",
            recipe_id: "recipe-1",
            product_name: "Chicken Crepe",
            actual_produced_quantity: 5,
          },
        ],
        new Map([["recipe-1", bom({ is_active: false })]]),
      ),
    ).toEqual({
      ok: false,
      error: 'Recipe "Chicken Crepe" is inactive and cannot be produced.',
    });

    expect(
      buildCompleteProductionPlan(
        [
          {
            line_id: "line-1",
            recipe_id: "recipe-1",
            product_name: "Chicken Crepe",
            actual_produced_quantity: 5,
          },
        ],
        new Map([["recipe-1", bom({ ingredients: [] })]]),
      ),
    ).toEqual({
      ok: false,
      error: 'Recipe "Chicken Crepe" has no ingredients.',
    });
  });

  it("includes ingredient cost breakdown on each batch plan", () => {
    const result = buildCompleteProductionPlan(
      [
        {
          line_id: "line-1",
          recipe_id: "recipe-1",
          product_name: "Chicken Crepe",
          actual_produced_quantity: 10,
        },
      ],
      new Map([["recipe-1", bom()]]),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.plan.batches[0]?.cost_breakdown).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ingredient_id: "flour",
          consumed_quantity: 2,
          inventory_unit_cost: 1.5,
          line_cost: 3,
        }),
        expect.objectContaining({
          ingredient_id: "milk",
          consumed_quantity: 1,
          inventory_unit_cost: 2,
          line_cost: 2,
        }),
      ]),
    );
  });

  it("rejects missing inventory valuation", () => {
    const result = buildCompleteProductionPlan(
      [
        {
          line_id: "line-1",
          recipe_id: "recipe-1",
          product_name: "Chicken Crepe",
          actual_produced_quantity: 10,
        },
      ],
      new Map([
        [
          "recipe-1",
          bom({
            ingredients: [
              {
                ingredient_id: "flour",
                quantity_per_yield: 2,
                unit: "kg",
                cost_per_unit: null,
                name: "Flour",
                current_stock: 100,
              },
            ],
          }),
        ],
      ]),
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toMatch(/missing inventory valuation/i);
  });

  it("rejects a zero inventory unit cost", () => {
    const result = buildCompleteProductionPlan(
      [
        {
          line_id: "line-1",
          recipe_id: "recipe-1",
          product_name: "Chicken Crepe",
          actual_produced_quantity: 10,
        },
      ],
      new Map([
        [
          "recipe-1",
          bom({
            ingredients: [
              {
                ingredient_id: "flour",
                quantity_per_yield: 2,
                unit: "kg",
                cost_per_unit: 1.5,
                name: "Flour",
                current_stock: 100,
              },
              {
                ingredient_id: "parsley",
                quantity_per_yield: 0.01,
                unit: "kg",
                cost_per_unit: 0,
                name: "Parsley",
                current_stock: 1,
              },
            ],
          }),
        ],
      ]),
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toMatch(/missing inventory valuation for "parsley"/i);
  });

  it("rejects missing ingredients on the recipe BOM", () => {
    const result = buildCompleteProductionPlan(
      [
        {
          line_id: "line-1",
          recipe_id: "recipe-1",
          product_name: "Chicken Crepe",
          actual_produced_quantity: 10,
        },
      ],
      new Map([
        [
          "recipe-1",
          bom({
            ingredients: [
              {
                ingredient_id: "gone",
                quantity_per_yield: 1,
                unit: "kg",
                cost_per_unit: null,
                name: "Missing ingredient",
                current_stock: 0,
                is_missing: true,
              },
            ],
          }),
        ],
      ]),
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toMatch(/missing ingredient/i);
  });
});

describe("validateInventoryForCompletion", () => {
  it("returns a friendly message when stock is insufficient", () => {
    expect(
      validateInventoryForCompletion([
        {
          ingredient_id: "flour",
          ingredient_name: "Flour",
          quantity: 12,
          unit: "kg",
          unit_cost: 1.5,
          total_cost: 18,
          available_stock: 10,
        },
      ]),
    ).toBe('Insufficient stock for "Flour". Required 12, available 10.');
  });

  it("passes when stock is sufficient", () => {
    expect(
      validateInventoryForCompletion([
        {
          ingredient_id: "flour",
          ingredient_name: "Flour",
          quantity: 10,
          unit: "kg",
          unit_cost: 1.5,
          total_cost: 15,
          available_stock: 10,
        },
      ]),
    ).toBeNull();
  });
});

describe("logProductionCompleted", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits a ProductionCompleted structured log", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => undefined);

    logProductionCompleted({
      session_id: "session-1",
      batch_ids: ["batch-1"],
      product_ids: ["recipe-1"],
      produced_quantity: 5,
      total_cost: 2.5,
    });

    expect(spy).toHaveBeenCalledWith("ProductionCompleted", {
      session_id: "session-1",
      batch_ids: ["batch-1"],
      product_ids: ["recipe-1"],
      produced_quantity: 5,
      total_cost: 2.5,
    });
  });
});

describe("listZeroUnitCostConsumptions", () => {
  it("lists unique sorted names with missing or zero unit cost and consumed qty", () => {
    const names = listZeroUnitCostConsumptions(
      [
        {
          line_id: "line-1",
          recipe_id: "recipe-1",
          product_name: "Chicken Crepe",
          actual_produced_quantity: 10,
        },
      ],
      new Map([
        [
          "recipe-1",
          bom({
            ingredients: [
              {
                ingredient_id: "flour",
                quantity_per_yield: 2,
                unit: "kg",
                cost_per_unit: 1.5,
                name: "Flour",
                current_stock: 100,
              },
              {
                ingredient_id: "salt",
                quantity_per_yield: 0.01,
                unit: "kg",
                cost_per_unit: 0,
                name: "Salt",
                current_stock: 1,
              },
              {
                ingredient_id: "parsley",
                quantity_per_yield: 0.01,
                unit: "kg",
                cost_per_unit: null,
                name: "Parsley",
                current_stock: 1,
              },
            ],
          }),
        ],
      ]),
    );

    expect(names).toEqual(["Parsley", "Salt"]);
    expect(formatZeroCostConsumptionWarning(names)).toBe(
      "These ingredients have no unit cost: Parsley, Salt. Set Cost per unit in Inventory before finishing.",
    );
  });

  it("returns no names when every consumed ingredient has a positive unit cost", () => {
    expect(
      listZeroUnitCostConsumptions(
        [
          {
            line_id: "line-1",
            recipe_id: "recipe-1",
            product_name: "Chicken Crepe",
            actual_produced_quantity: 10,
          },
        ],
        new Map([["recipe-1", bom()]]),
      ),
    ).toEqual([]);
    expect(formatZeroCostConsumptionWarning([])).toBeNull();
  });

  it("omits ingredients whose scaled consumption is zero", () => {
    const names = listZeroUnitCostConsumptions(
      [
        {
          line_id: "line-1",
          recipe_id: "recipe-1",
          product_name: "Chicken Crepe",
          actual_produced_quantity: 10,
        },
      ],
      new Map([
        [
          "recipe-1",
          bom({
            ingredients: [
              {
                ingredient_id: "garnish",
                quantity_per_yield: 0,
                unit: "kg",
                cost_per_unit: 0,
                name: "Garnish",
                current_stock: 1,
              },
            ],
          }),
        ],
      ]),
    );

    expect(names).toEqual([]);
  });
});

describe("mapCompleteProductionRpcError", () => {
  it("maps double-complete, status, and missing RPC errors", () => {
    expect(
      mapCompleteProductionRpcError(
        "This production session is already completed.",
      ),
    ).toBe("This production session is already completed.");

    expect(
      mapCompleteProductionRpcError(
        "Only in-progress production sessions can be completed.",
      ),
    ).toBe("Only in-progress production sessions can be completed.");

    expect(
      mapCompleteProductionRpcError(
        "Could not find the function public.complete_production_session",
      ),
    ).toContain("complete-production database script");

    expect(
      mapCompleteProductionRpcError(
        "Cannot finish production. These ingredients have no unit cost: Parsley, Salt. Set Cost per unit in Inventory and try again.",
      ),
    ).toContain("Parsley, Salt");

    expect(
      mapCompleteProductionRpcError(
        "Cannot finish production. These components were allocated from batches with no unit cost: Chicken sauce. This cannot be fixed in Inventory — produce a new batch of the component with a valid cost, or resolve the existing batch cost separately.",
      ),
    ).toContain("Chicken sauce");

    expect(
      mapCompleteProductionRpcError(
        "Cannot finish production. These ingredients have no unit cost: Parsley. Set Cost per unit in Inventory and try again. These components were allocated from batches with no unit cost: Chicken sauce. This cannot be fixed in Inventory — produce a new batch of the component with a valid cost, or resolve the existing batch cost separately.",
      ),
    ).toMatch(/Parsley.*Chicken sauce/);
  });
});
