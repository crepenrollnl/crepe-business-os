import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InventoryMovementHistory } from "../types/inventory-movement-history";

const getByIngredientMock = vi.fn();

vi.mock("../services/inventory-movement-history-service", () => ({
  inventoryMovementHistoryService: {
    getInventoryMovementHistoryByIngredient: (...args: unknown[]) =>
      getByIngredientMock(...args),
    getInventoryMovementHistory: vi.fn(),
  },
}));

import { useIngredientMovementHistory } from "./use-ingredient-movement-history";

const INGREDIENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const SAMPLE_ROW: InventoryMovementHistory = {
  movement_id: "11111111-1111-4111-8111-111111111111",
  ingredient_id: INGREDIENT_ID,
  ingredient_name: "Flour",
  movement_type: "purchase_in",
  quantity: 10,
  unit: "kg",
  source_type: "purchase",
  source_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  occurred_at: "2026-07-25T16:00:00.000Z",
};

describe("useIngredientMovementHistory", () => {
  beforeEach(() => {
    getByIngredientMock.mockReset();
  });

  it("loads history for the given ingredient uuid", async () => {
    getByIngredientMock.mockResolvedValue({
      data: [SAMPLE_ROW],
      error: null,
    });

    const { result } = renderHook(() =>
      useIngredientMovementHistory(INGREDIENT_ID),
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(getByIngredientMock).toHaveBeenCalledTimes(1);
    expect(getByIngredientMock).toHaveBeenCalledWith(INGREDIENT_ID);
    expect(result.current.items).toEqual([SAMPLE_ROW]);
    expect(result.current.error).toBeNull();
  });

  it("returns an empty list when the ingredient has no movements", async () => {
    getByIngredientMock.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() =>
      useIngredientMovementHistory(INGREDIENT_ID),
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.items).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("surfaces a service error and clears items", async () => {
    getByIngredientMock.mockResolvedValue({
      data: null,
      error: "Failed to load inventory movement history",
    });

    const { result } = renderHook(() =>
      useIngredientMovementHistory(INGREDIENT_ID),
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.items).toEqual([]);
    expect(result.current.error).toBe(
      "Failed to load inventory movement history",
    );
  });
});
