/**
 * POS Sale tiles rank by sold quantity; recipe load still owns the list error.
 */

import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RecipeListItem } from "@/features/recipes/types/recipe";

const { getRecipesMock, getSoldQuantityByProductIdMock } = vi.hoisted(() => ({
  getRecipesMock: vi.fn(),
  getSoldQuantityByProductIdMock: vi.fn(),
}));

vi.mock("@/features/recipes/services/recipe-service", () => ({
  recipeService: {
    getRecipes: (...args: unknown[]) => getRecipesMock(...args),
  },
}));

vi.mock("@/features/sales/services/sales-read-service", () => ({
  salesReadService: {
    getSoldQuantityByProductId: (...args: unknown[]) =>
      getSoldQuantityByProductIdMock(...args),
  },
}));

vi.mock("@/features/sales/services/sales-service", () => ({
  salesService: {},
}));

vi.mock("@/features/accounting/services/accounting-context-service", () => ({
  accountingContextService: {
    getCurrentAccountingContext: vi.fn(),
  },
}));

import { usePosSale } from "./use-pos-sale";

const CHICKEN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const APPLE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const FANTA_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const LEMONADE_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

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

describe("usePosSale product ranking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRecipesMock.mockResolvedValue({
      data: [
        recipe({ id: LEMONADE_ID, name: "Lemonade" }),
        recipe({ id: CHICKEN_ID, name: "Chicken crepe" }),
        recipe({ id: FANTA_ID, name: "Fanta" }),
        recipe({ id: APPLE_ID, name: "Apple crepe" }),
      ],
      error: null,
    });
    getSoldQuantityByProductIdMock.mockResolvedValue({
      data: new Map<string, number>([
        [CHICKEN_ID, 10],
        [APPLE_ID, 6],
      ]),
      error: null,
    });
  });

  it("orders tiles by qty sold desc, then name A–Z", async () => {
    const { result } = renderHook(() => usePosSale());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBeNull();
    expect(result.current.products.map((product) => product.name)).toEqual([
      "Chicken crepe",
      "Apple crepe",
      "Fanta",
      "Lemonade",
    ]);
  });

  it("falls back to A–Z when the sold-qty aggregate fails, without a list error", async () => {
    getSoldQuantityByProductIdMock.mockResolvedValue({
      data: null,
      error: "Failed to load sold quantities",
    });

    const { result } = renderHook(() => usePosSale());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBeNull();
    expect(result.current.products.map((product) => product.name)).toEqual([
      "Apple crepe",
      "Chicken crepe",
      "Fanta",
      "Lemonade",
    ]);
  });

  it("still blocks the list when recipes fail", async () => {
    getRecipesMock.mockResolvedValue({
      data: null,
      error: "Failed to load recipes",
    });

    const { result } = renderHook(() => usePosSale());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.products).toEqual([]);
    expect(result.current.error).toBe("Failed to load recipes");
  });
});
