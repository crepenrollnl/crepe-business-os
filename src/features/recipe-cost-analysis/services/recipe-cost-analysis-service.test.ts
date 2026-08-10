/**
 * Service-level coverage for recipeCostAnalysisService (DEV-057).
 *
 * Reads must go only through get_recipe_cost_analysis / get_recipe_cost RPCs.
 * The service must not query tables directly, recalculate costs, cache,
 * or write data.
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

import { recipeCostAnalysisService } from "./recipe-cost-analysis-service";
import type { RecipeCostAnalysis } from "../types/recipe-cost-analysis";

const RECIPE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RECIPE_ID_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const insertMock = vi.fn();
const updateMock = vi.fn();
const deleteMock = vi.fn();

function costRow(overrides?: Record<string, unknown>) {
  return {
    recipe_id: RECIPE_ID,
    recipe_name: "Chicken Crepe",
    total_cost: "12.5000",
    ingredient_count: 3,
    last_cost_update: "2026-07-25T16:00:00.000Z",
    cost_per_portion: "1.2500",
    ...overrides,
  };
}

function mappedCost(
  overrides?: Partial<RecipeCostAnalysis>,
): RecipeCostAnalysis {
  return {
    recipe_id: RECIPE_ID,
    recipe_name: "Chicken Crepe",
    total_cost: 12.5,
    ingredient_count: 3,
    last_cost_update: "2026-07-25T16:00:00.000Z",
    cost_per_portion: 1.25,
    ...overrides,
  };
}

function expectNoDirectWrites() {
  expect(supabaseMock.from).not.toHaveBeenCalled();
  expect(insertMock).not.toHaveBeenCalled();
  expect(updateMock).not.toHaveBeenCalled();
  expect(deleteMock).not.toHaveBeenCalled();
}

function expectReadOnly(rpcName: string) {
  expect(supabaseMock.rpc.mock.calls.map((call) => call[0])).toEqual([
    rpcName,
  ]);
  expect(supabaseMock.auth.getUser).not.toHaveBeenCalled();
  expectNoDirectWrites();
}

describe("recipeCostAnalysisService.getRecipeCostAnalysis (DEV-057)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertMock.mockReset();
    updateMock.mockReset();
    deleteMock.mockReset();
    supabaseMock.from.mockImplementation(() => ({
      select: vi.fn(),
      insert: insertMock,
      update: updateMock,
      delete: deleteMock,
    }));
  });

  it("retrieves recipe cost list successfully via get_recipe_cost_analysis", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [
        costRow({
          recipe_id: RECIPE_ID_2,
          recipe_name: "Apple Crepe",
          total_cost: "8.0000",
          ingredient_count: 2,
          cost_per_portion: "0.8000",
        }),
        costRow(),
      ],
      error: null,
    });

    const result = await recipeCostAnalysisService.getRecipeCostAnalysis();

    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(2);
    expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
    expect(supabaseMock.rpc).toHaveBeenCalledWith("get_recipe_cost_analysis");
    expectReadOnly("get_recipe_cost_analysis");
  });

  it("returns an empty array when no recipes exist", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [],
      error: null,
    });

    const result = await recipeCostAnalysisService.getRecipeCostAnalysis();

    expect(result.error).toBeNull();
    expect(result.data).toEqual([] satisfies RecipeCostAnalysis[]);
    expectReadOnly("get_recipe_cost_analysis");
  });

  it("maps RPC rows to typed RecipeCostAnalysis DTOs", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [
        costRow({
          recipe_name: "Nutella Banana Crepe",
          total_cost: "20.0000",
          ingredient_count: 4,
          last_cost_update: "2026-07-24T12:00:00.000Z",
          cost_per_portion: "2.0000",
        }),
      ],
      error: null,
    });

    const result = await recipeCostAnalysisService.getRecipeCostAnalysis();

    expect(result.error).toBeNull();
    expect(result.data).toEqual([
      mappedCost({
        recipe_name: "Nutella Banana Crepe",
        total_cost: 20,
        ingredient_count: 4,
        last_cost_update: "2026-07-24T12:00:00.000Z",
        cost_per_portion: 2,
      }),
    ] satisfies RecipeCostAnalysis[]);
    expectReadOnly("get_recipe_cost_analysis");
  });

  it("maps cost_per_portion from SQL without recalculation", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [
        costRow({
          total_cost: "100.0000",
          cost_per_portion: "9.9900",
        }),
      ],
      error: null,
    });

    const result = await recipeCostAnalysisService.getRecipeCostAnalysis();

    expect(result.error).toBeNull();
    // Values come from the RPC as-is - never recomputed from total_cost.
    expect(result.data?.[0]?.total_cost).toBe(100);
    expect(result.data?.[0]?.cost_per_portion).toBe(9.99);
    expectReadOnly("get_recipe_cost_analysis");
  });

  it("maps null cost_per_portion without recalculation", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [costRow({ cost_per_portion: null })],
      error: null,
    });

    const result = await recipeCostAnalysisService.getRecipeCostAnalysis();

    expect(result.error).toBeNull();
    expect(result.data?.[0]?.cost_per_portion).toBeNull();
    expectReadOnly("get_recipe_cost_analysis");
  });

  it("maps missing get_recipe_cost_analysis function errors", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message:
          "Could not find the function public.get_recipe_cost_analysis",
      },
    });

    const result = await recipeCostAnalysisService.getRecipeCostAnalysis();

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "Recipe cost analysis is not available yet. Apply the recipe cost analysis database script and try again.",
    );
    expectNoDirectWrites();
  });

  it("rejects invalid list payloads", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: { not: "an-array" },
      error: null,
    });

    const result = await recipeCostAnalysisService.getRecipeCostAnalysis();

    expect(result.data).toBeNull();
    expect(result.error).toBe("Recipe cost analysis response was invalid.");
    expectNoDirectWrites();
  });

  it("is read-only and never writes tables", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [costRow()],
      error: null,
    });

    await recipeCostAnalysisService.getRecipeCostAnalysis();

    expectReadOnly("get_recipe_cost_analysis");
  });

  it("never queries recipes, ingredients, or purchases tables directly", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [costRow()],
      error: null,
    });

    await recipeCostAnalysisService.getRecipeCostAnalysis();

    expect(supabaseMock.from).not.toHaveBeenCalledWith("recipe_cost_analysis");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("recipes");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("recipe_items");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("ingredients");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("purchases");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("purchase_items");
    expectNoDirectWrites();
  });
});

describe("recipeCostAnalysisService.getRecipeCost (DEV-057)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertMock.mockReset();
    updateMock.mockReset();
    deleteMock.mockReset();
    supabaseMock.from.mockImplementation(() => ({
      select: vi.fn(),
      insert: insertMock,
      update: updateMock,
      delete: deleteMock,
    }));
  });

  it("retrieves a single recipe cost successfully via get_recipe_cost", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: costRow({
        total_cost: "15.0000",
        ingredient_count: 5,
        cost_per_portion: "1.5000",
      }),
      error: null,
    });

    const result = await recipeCostAnalysisService.getRecipeCost(RECIPE_ID);

    expect(result.error).toBeNull();
    expect(result.data).toEqual(
      mappedCost({
        total_cost: 15,
        ingredient_count: 5,
        cost_per_portion: 1.5,
      }) satisfies RecipeCostAnalysis,
    );
    expect(supabaseMock.rpc).toHaveBeenCalledWith("get_recipe_cost", {
      p_recipe_id: RECIPE_ID,
    });
    expectReadOnly("get_recipe_cost");
  });

  it("maps cost_per_portion for a single recipe without recalculation", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: costRow({
        total_cost: "50.0000",
        cost_per_portion: "3.3300",
      }),
      error: null,
    });

    const result = await recipeCostAnalysisService.getRecipeCost(
      `  ${RECIPE_ID}  `,
    );

    expect(result.error).toBeNull();
    expect(result.data?.cost_per_portion).toBe(3.33);
    expect(result.data?.total_cost).toBe(50);
    expect(supabaseMock.rpc).toHaveBeenCalledWith("get_recipe_cost", {
      p_recipe_id: RECIPE_ID,
    });
    expectReadOnly("get_recipe_cost");
  });

  it("rejects invalid recipe id without calling the RPC", async () => {
    const blank = await recipeCostAnalysisService.getRecipeCost("   ");
    expect(blank.data).toBeNull();
    expect(blank.error).toBe("Recipe id is required.");

    const invalid = await recipeCostAnalysisService.getRecipeCost("not-a-uuid");
    expect(invalid.data).toBeNull();
    expect(invalid.error).toBe("Recipe id is required.");

    expect(supabaseMock.rpc).not.toHaveBeenCalled();
    expectNoDirectWrites();
  });

  it("maps missing recipe as not found", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: null,
    });

    const result = await recipeCostAnalysisService.getRecipeCost(RECIPE_ID);

    expect(result.data).toBeNull();
    expect(result.error).toBe("Recipe cost was not found.");
    expectNoDirectWrites();
  });

  it("maps missing get_recipe_cost function errors", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message: "Could not find the function public.get_recipe_cost",
      },
    });

    const result = await recipeCostAnalysisService.getRecipeCost(RECIPE_ID);

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "Recipe cost analysis is not available yet. Apply the recipe cost analysis database script and try again.",
    );
    expectNoDirectWrites();
  });

  it("maps missing recipe_cost_analysis relation errors", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message: 'relation "recipe_cost_analysis" does not exist',
        code: "42P01",
      },
    });

    const result = await recipeCostAnalysisService.getRecipeCost(RECIPE_ID);

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "Recipe cost analysis is not available yet. Apply the recipe cost analysis database script and try again.",
    );
    expectNoDirectWrites();
  });

  it("rejects invalid single-recipe payloads", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: costRow({ recipe_id: "not-a-uuid" }),
      error: null,
    });

    const result = await recipeCostAnalysisService.getRecipeCost(RECIPE_ID);

    expect(result.data).toBeNull();
    expect(result.error).toBe("Recipe cost response was invalid.");
    expectNoDirectWrites();
  });

  it("is read-only and never writes tables", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: costRow(),
      error: null,
    });

    await recipeCostAnalysisService.getRecipeCost(RECIPE_ID);

    expectReadOnly("get_recipe_cost");
  });
});
