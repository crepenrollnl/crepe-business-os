import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getStockLevelsMock, getInventoryMock } = vi.hoisted(() => ({
  getStockLevelsMock: vi.fn(),
  getInventoryMock: vi.fn(),
}));

vi.mock("../services/inventory-service", () => ({
  inventoryService: {
    getStockLevels: () => getStockLevelsMock(),
    getInventory: () => getInventoryMock(),
  },
}));

import { useIngredientStockLevels } from "./use-ingredient-stock-levels";

const BAKING = { id: "c-1", name: "Baking" };
const DAIRY = { id: "c-2", name: "Dairy" };

function level(id: string, name: string, stock: number, category: typeof BAKING) {
  return {
    id,
    name,
    category_id: category.id,
    unit: "kg",
    current_stock: stock,
    minimum_stock: 1,
    active: true,
    category,
  };
}

describe("useIngredientStockLevels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getStockLevelsMock.mockResolvedValue({
      data: [
        level("i-1", "Milk", 5, DAIRY),
        level("i-2", "Flour", 10, BAKING),
        level("i-3", "Butter", 1, DAIRY),
      ],
      error: null,
    });
  });

  it("reads only the cost-free stock levels", async () => {
    const { result } = renderHook(() => useIngredientStockLevels());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getStockLevelsMock).toHaveBeenCalledTimes(1);
    expect(getInventoryMock).not.toHaveBeenCalled();
    expect(result.current.items.map((item) => item.name)).toEqual([
      "Butter",
      "Flour",
      "Milk",
    ]);
    expect(result.current.categories).toEqual([BAKING, DAIRY]);
  });

  it("filters by category and search, and sorts by quantity", async () => {
    const { result } = renderHook(() => useIngredientStockLevels());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.setCategoryFilter("c-2");
    });
    expect(result.current.items.map((item) => item.name)).toEqual([
      "Butter",
      "Milk",
    ]);

    act(() => {
      result.current.toggleSort("current_stock");
    });
    expect(result.current.items.map((item) => item.current_stock)).toEqual([1, 5]);

    act(() => {
      result.current.setSearch("mil");
    });
    expect(result.current.items.map((item) => item.name)).toEqual(["Milk"]);
    expect(result.current.hasActiveFilters).toBe(true);
  });

  it("shows the read error", async () => {
    getStockLevelsMock.mockResolvedValue({ data: null, error: "permission denied" });

    const { result } = renderHook(() => useIngredientStockLevels());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("permission denied");
    expect(result.current.items).toEqual([]);
  });
});
