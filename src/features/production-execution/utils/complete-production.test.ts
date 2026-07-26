import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertCanCompleteProductionSession,
  buildCompleteProductionPlan,
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
  });
});
