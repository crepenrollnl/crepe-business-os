import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IngredientWithRelations } from "../types/inventory";

const { getMyRoleMock, recordAdjustmentMock } = vi.hoisted(() => ({
  getMyRoleMock: vi.fn(),
  recordAdjustmentMock: vi.fn(),
}));

vi.mock("@/features/auth/services/auth-service", () => ({
  authService: {
    getMyRole: (...args: unknown[]) => getMyRoleMock(...args),
  },
}));

vi.mock("../services/inventory-adjustment-service", () => ({
  inventoryAdjustmentService: {
    recordAdjustment: (...args: unknown[]) => recordAdjustmentMock(...args),
  },
}));

import { useInventoryAdjustment } from "./use-inventory-adjustment";

const item: IngredientWithRelations = {
  id: "ing-1",
  name: "Flour",
  category_id: "cat-1",
  supplier_id: null,
  unit: "kg",
  current_stock: 10,
  minimum_stock: 2,
  cost_per_unit: 1.5,
  category: { id: "cat-1", name: "Baking" },
  supplier: null,
};

describe("useInventoryAdjustment", () => {
  beforeEach(() => {
    getMyRoleMock.mockReset();
    recordAdjustmentMock.mockReset();
    getMyRoleMock.mockResolvedValue("owner");
  });

  it.each([
    ["owner", true],
    ["partner", true],
    ["seller", false],
  ] as const)("canAdjustStock is %s → %s", async (role, expected) => {
    getMyRoleMock.mockResolvedValue(role);
    const { result } = renderHook(() => useInventoryAdjustment());

    await waitFor(() => {
      expect(result.current.canAdjustStock).toBe(expected);
    });
  });

  it("opens and closes the modal around the selected ingredient", () => {
    const { result } = renderHook(() => useInventoryAdjustment());

    act(() => {
      result.current.openAdjustModal(item);
    });

    expect(result.current.isAdjustModalOpen).toBe(true);
    expect(result.current.adjustingItem).toEqual(item);

    act(() => {
      result.current.closeAdjustModal();
    });

    expect(result.current.isAdjustModalOpen).toBe(false);
    expect(result.current.adjustingItem).toBeNull();
  });

  it("refreshes on success and leaves the banner on failure", async () => {
    const onSuccess = vi.fn().mockResolvedValue(undefined);
    recordAdjustmentMock.mockResolvedValueOnce({
      data: { id: "adj-1", movement_id: "mov-1", current_stock: 14 },
      error: null,
    });

    const { result } = renderHook(() => useInventoryAdjustment({ onSuccess }));

    act(() => {
      result.current.openAdjustModal(item);
    });

    await act(async () => {
      await result.current.submitAdjustment({
        ingredientId: item.id,
        direction: "increase",
        quantity: 4,
        reason: "physical_count",
        note: null,
      });
    });

    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(result.current.isAdjustModalOpen).toBe(false);
    expect(result.current.adjustError).toBeNull();

    recordAdjustmentMock.mockResolvedValueOnce({
      data: null,
      error: "You don't have permission to adjust stock.",
    });

    act(() => {
      result.current.openAdjustModal(item);
    });

    await act(async () => {
      const saved = await result.current.submitAdjustment({
        ingredientId: item.id,
        direction: "increase",
        quantity: 1,
        reason: "other",
        note: null,
      });
      expect(saved).toBe(false);
    });

    await waitFor(() => {
      expect(result.current.adjustError).toBe(
        "You don't have permission to adjust stock.",
      );
    });
    expect(result.current.isAdjustModalOpen).toBe(true);
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });
});
