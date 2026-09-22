import { beforeEach, describe, expect, it, vi } from "vitest";

const { supabaseMock } = vi.hoisted(() => ({
  supabaseMock: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: supabaseMock,
}));

import { recipeCostReportService } from "./recipe-cost-report-service";
import type { RecipeCostReportRow } from "../types/recipe-cost-report";

const BATTER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FLOUR_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MILK_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ZERO_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function reportRow(overrides?: Record<string, unknown>) {
  return {
    recipe_id: BATTER_ID,
    recipe_name: "Batter",
    recipe_role: "component",
    yield_quantity: 4,
    yield_unit: "portion",
    is_active: true,
    selling_price: null,
    total_cost: 3.8,
    cost_per_yield_unit: 0.95,
    has_missing_cost_data: false,
    missing_ingredients: [],
    calculation_error: null,
    ...overrides,
  };
}

function mappedRow(
  overrides?: Partial<RecipeCostReportRow>,
): RecipeCostReportRow {
  return {
    recipe_id: BATTER_ID,
    recipe_name: "Batter",
    recipe_role: "component",
    yield_quantity: 4,
    yield_unit: "portion",
    is_active: true,
    selling_price: null,
    total_cost: 3.8,
    cost_per_yield_unit: 0.95,
    has_missing_cost_data: false,
    missing_ingredients: [],
    calculation_error: null,
    ...overrides,
  };
}

describe("recipeCostReportService.getRecipeCostReport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps a successful get_recipe_cost_report payload", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [
        reportRow(),
        reportRow({
          recipe_id: ZERO_ID,
          recipe_name: "Chicken Crepe",
          recipe_role: "assembly",
          yield_quantity: 1,
          yield_unit: "pcs",
          selling_price: 9.5,
          total_cost: "4.6000",
          cost_per_yield_unit: "4.6000",
        }),
      ],
      error: null,
    });

    const result = await recipeCostReportService.getRecipeCostReport();

    expect(result.error).toBeNull();
    expect(supabaseMock.rpc).toHaveBeenCalledWith("get_recipe_cost_report");
    expect(supabaseMock.from).not.toHaveBeenCalled();
    expect(result.data).toEqual([
      mappedRow(),
      mappedRow({
        recipe_id: ZERO_ID,
        recipe_name: "Chicken Crepe",
        recipe_role: "assembly",
        yield_quantity: 1,
        yield_unit: "pcs",
        selling_price: 9.5,
        total_cost: 4.6,
        cost_per_yield_unit: 4.6,
      }),
    ]);
  });

  it("maps require_role insufficient-permissions errors", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message: "Insufficient permissions for this action (role: seller).",
      },
    });

    const result = await recipeCostReportService.getRecipeCostReport();

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "You do not have permission to view recipe cost.",
    );
  });

  it("rejects a malformed report payload", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: { not: "an-array" },
      error: null,
    });

    const result = await recipeCostReportService.getRecipeCostReport();

    expect(result.data).toBeNull();
    expect(result.error).toBe("Recipe cost report response was invalid.");
  });
});

describe("recipeCostReportService.getRecipeCostDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps a successful get_recipe_cost_detail payload", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: {
        ...reportRow(),
        ingredient_breakdown: [
          {
            ingredient_id: FLOUR_ID,
            ingredient_name: "Flour",
            quantity: 2,
            unit: "kg",
            cost_per_unit: 1.5,
            line_cost: 3,
          },
          {
            ingredient_id: MILK_ID,
            ingredient_name: "Milk",
            quantity: 1,
            unit: "L",
            cost_per_unit: 0.8,
            line_cost: 0.8,
          },
        ],
      },
      error: null,
    });

    const result = await recipeCostReportService.getRecipeCostDetail(
      `  ${BATTER_ID}  `,
    );

    expect(result.error).toBeNull();
    expect(supabaseMock.rpc).toHaveBeenCalledWith("get_recipe_cost_detail", {
      p_recipe_id: BATTER_ID,
    });
    expect(result.data).toEqual({
      ...mappedRow(),
      ingredient_breakdown: [
        {
          ingredient_id: FLOUR_ID,
          ingredient_name: "Flour",
          quantity: 2,
          unit: "kg",
          cost_per_unit: 1.5,
          line_cost: 3,
        },
        {
          ingredient_id: MILK_ID,
          ingredient_name: "Milk",
          quantity: 1,
          unit: "L",
          cost_per_unit: 0.8,
          line_cost: 0.8,
        },
      ],
    });
  });

  it("maps require_role insufficient-permissions errors", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message: "Insufficient permissions for this action (role: seller).",
      },
    });

    const result =
      await recipeCostReportService.getRecipeCostDetail(BATTER_ID);

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "You do not have permission to view recipe cost.",
    );
  });

  it("keeps the explode cycle message instead of a generic fallback", async () => {
    const cycleMessage =
      "Recipe sub-components form a cycle. Remove the circular reference before planning or producing.";

    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: { message: cycleMessage },
    });

    const result =
      await recipeCostReportService.getRecipeCostDetail(BATTER_ID);

    expect(result.data).toBeNull();
    expect(result.error).toBe(cycleMessage);
    expect(result.error).not.toBe("Failed to load recipe cost detail.");
  });

  it("rejects a malformed detail payload", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: reportRow({ recipe_id: "not-a-uuid" }),
      error: null,
    });

    const result =
      await recipeCostReportService.getRecipeCostDetail(BATTER_ID);

    expect(result.data).toBeNull();
    expect(result.error).toBe("Recipe cost detail response was invalid.");
  });

  it("rejects an invalid recipe id without calling the RPC", async () => {
    const result = await recipeCostReportService.getRecipeCostDetail("nope");

    expect(result.data).toBeNull();
    expect(result.error).toBe("Recipe id is required.");
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });
});
