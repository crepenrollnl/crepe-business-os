/**
 * Service-level coverage for listSaleableNow (Mode A).
 *
 * Reads recipes + recipe_components, report_finished_goods_summary, and
 * ingredients.current_stock. Must not call RPCs or write tables.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IngredientWithRelations } from "@/features/inventory/types/inventory";
import type { RecipeListItem } from "@/features/recipes/types/recipe";
import type { FinishedGoodsSummaryRow } from "@/features/reports/types/report";

const {
  getRecipesMock,
  getFinishedGoodsSummaryMock,
  getInventoryMock,
  supabaseMock,
} = vi.hoisted(() => {
  const supabaseMock = {
    from: vi.fn(),
    rpc: vi.fn(),
  };
  return {
    getRecipesMock: vi.fn(),
    getFinishedGoodsSummaryMock: vi.fn(),
    getInventoryMock: vi.fn(),
    supabaseMock,
  };
});

vi.mock("@/lib/supabase", () => ({
  supabase: supabaseMock,
}));

vi.mock("@/features/recipes/services/recipe-service", () => ({
  recipeService: {
    getRecipes: (...args: unknown[]) => getRecipesMock(...args),
  },
}));

vi.mock("@/features/reports/services/report-service", () => ({
  reportService: {
    getFinishedGoodsSummary: (...args: unknown[]) =>
      getFinishedGoodsSummaryMock(...args),
  },
}));

vi.mock("@/features/inventory/services/inventory-service", () => ({
  inventoryService: {
    getInventory: (...args: unknown[]) => getInventoryMock(...args),
  },
}));

import { listSaleableNow } from "./saleable-now-service";

const CHICKEN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SAUCE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const DOUGH = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CUCUMBER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const INACTIVE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const COMPONENT_ONLY = "ffffffff-ffff-4fff-8fff-ffffffffffff";

const insertMock = vi.fn();
const updateMock = vi.fn();
const deleteMock = vi.fn();

function recipe(
  overrides: Partial<RecipeListItem> & Pick<RecipeListItem, "id" | "name">,
): RecipeListItem {
  return {
    description: null,
    yield_quantity: 1,
    yield_unit: "pcs",
    is_active: true,
    recipe_role: "assembly",
    selling_price: 10,
    image_url: null,
    created_at: "2026-01-01T00:00:00.000Z",
    item_count: 0,
    ...overrides,
  };
}

function fgRow(
  overrides: Partial<FinishedGoodsSummaryRow> &
    Pick<FinishedGoodsSummaryRow, "product_id">,
): FinishedGoodsSummaryRow {
  return {
    product_name: "Component",
    available_quantity: 0,
    active_batch_count: 1,
    average_unit_cost: 1,
    inventory_value: 1,
    oldest_batch_at: "2026-01-01T00:00:00.000Z",
    newest_batch_at: "2026-01-01T00:00:00.000Z",
    production_status: "available",
    ...overrides,
  };
}

function ingredient(
  overrides: Partial<IngredientWithRelations> &
    Pick<IngredientWithRelations, "id" | "name">,
): IngredientWithRelations {
  return {
    category_id: null,
    supplier_id: null,
    unit: "kg",
    current_stock: 0,
    minimum_stock: 0,
    cost_per_unit: 1,
    category: null,
    supplier: null,
    ...overrides,
  };
}

function mockComponentQuery(
  rows: Array<Record<string, unknown>>,
  error: unknown = null,
) {
  const orderMock = vi.fn().mockResolvedValue({
    data: error ? null : rows,
    error,
  });
  const inMock = vi.fn().mockReturnValue({
    order: orderMock,
  });
  const selectMock = vi.fn().mockReturnValue({
    in: inMock,
  });

  supabaseMock.from.mockImplementation((table: string) => {
    if (table === "recipe_components") {
      return {
        select: selectMock,
        insert: insertMock,
        update: updateMock,
        delete: deleteMock,
      };
    }

    throw new Error(`Unexpected table: ${table}`);
  });

  return { selectMock, inMock, orderMock };
}

describe("listSaleableNow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertMock.mockReset();
    updateMock.mockReset();
    deleteMock.mockReset();

    getRecipesMock.mockResolvedValue({
      data: [
        recipe({ id: CHICKEN, name: "Chicken Crepe" }),
        recipe({
          id: SAUCE,
          name: "Sauce",
          recipe_role: "component",
          selling_price: null,
        }),
        recipe({
          id: DOUGH,
          name: "Dough",
          recipe_role: "component",
          selling_price: null,
        }),
        recipe({
          id: INACTIVE,
          name: "Inactive Crepe",
          is_active: false,
        }),
        recipe({
          id: COMPONENT_ONLY,
          name: "Sold component",
          recipe_role: "component",
          selling_price: 5,
        }),
      ],
      error: null,
    });
    getFinishedGoodsSummaryMock.mockResolvedValue({
      data: [
        fgRow({
          product_id: SAUCE,
          product_name: "Sauce",
          available_quantity: 10,
        }),
        fgRow({
          product_id: DOUGH,
          product_name: "Dough",
          available_quantity: 6,
        }),
      ],
      error: null,
    });
    getInventoryMock.mockResolvedValue({
      data: [ingredient({ id: CUCUMBER, name: "Cucumber", current_stock: 5 })],
      error: null,
    });
  });

  it("builds maps and returns Mode A portions with a bottleneck", async () => {
    const { selectMock, inMock, orderMock } = mockComponentQuery([
      {
        id: "11111111-1111-4111-8111-111111111111",
        assembly_recipe_id: CHICKEN,
        component_recipe_id: SAUCE,
        ingredient_id: null,
        quantity: "1",
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        assembly_recipe_id: CHICKEN,
        component_recipe_id: DOUGH,
        ingredient_id: null,
        quantity: "2",
      },
    ]);

    const result = await listSaleableNow();

    expect(result.error).toBeNull();
    expect(result.data).toEqual([
      {
        product_id: CHICKEN,
        product_name: "Chicken Crepe",
        max_portions: 3,
        bottleneck_name: "Dough",
        bottleneck_kind: "component",
      },
    ]);
    expect(supabaseMock.from).toHaveBeenCalledWith("recipe_components");
    expect(selectMock).toHaveBeenCalledWith(
      "id, assembly_recipe_id, component_recipe_id, ingredient_id, quantity",
    );
    expect(inMock).toHaveBeenCalledWith("assembly_recipe_id", [CHICKEN]);
    expect(orderMock).toHaveBeenCalledWith("id", { ascending: true });
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("fails when recipes fail and does not query recipe_components", async () => {
    getRecipesMock.mockResolvedValue({
      data: null,
      error: "Failed to load recipes",
    });

    const result = await listSaleableNow();

    expect(result.data).toBeNull();
    expect(result.error).toBe("Failed to load recipes");
    expect(supabaseMock.from).not.toHaveBeenCalled();
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it("fails when finished goods summary fails", async () => {
    getFinishedGoodsSummaryMock.mockResolvedValue({
      data: null,
      error: "Failed to load finished goods summary",
    });

    const result = await listSaleableNow();

    expect(result.data).toBeNull();
    expect(result.error).toBe("Failed to load finished goods summary");
    expect(supabaseMock.from).not.toHaveBeenCalled();
  });

  it("fails when inventory fails", async () => {
    getInventoryMock.mockResolvedValue({
      data: null,
      error: "Failed to load inventory",
    });

    const result = await listSaleableNow();

    expect(result.data).toBeNull();
    expect(result.error).toBe("Failed to load inventory");
    expect(supabaseMock.from).not.toHaveBeenCalled();
  });

  it("fails when recipe_components fails after the parallel reads succeed", async () => {
    mockComponentQuery([], { message: "permission denied" });

    const result = await listSaleableNow();

    expect(result.data).toBeNull();
    expect(result.error).toBe("permission denied");
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it("returns an empty list without querying components when no POS products exist", async () => {
    getRecipesMock.mockResolvedValue({
      data: [
        recipe({
          id: SAUCE,
          name: "Sauce",
          recipe_role: "component",
          selling_price: null,
        }),
      ],
      error: null,
    });

    const result = await listSaleableNow();

    expect(result.error).toBeNull();
    expect(result.data).toEqual([]);
    expect(supabaseMock.from).not.toHaveBeenCalled();
  });
});
