import { beforeEach, describe, expect, it, vi } from "vitest";

const { supabaseMock } = vi.hoisted(() => ({
  supabaseMock: {
    rpc: vi.fn(),
  },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: supabaseMock,
}));

import {
  inventoryAdjustmentService,
  mapInventoryAdjustmentError,
} from "./inventory-adjustment-service";

describe("mapInventoryAdjustmentError", () => {
  it("maps a below-zero decrease and shows available stock", () => {
    expect(
      mapInventoryAdjustmentError({
        message:
          'Cannot decrease stock below zero for "Chicken". Requested 5, available 2.',
      }),
    ).toBe("Not enough stock for this decrease. Available: 2.");
  });

  it("maps a below-zero decrease without an available amount", () => {
    expect(
      mapInventoryAdjustmentError({
        message: "Cannot decrease stock below zero for this ingredient.",
      }),
    ).toBe("Not enough stock for this decrease.");
  });

  it("maps a require_role permission failure", () => {
    expect(
      mapInventoryAdjustmentError({
        message: "Insufficient permissions for this action (role: seller).",
      }),
    ).toBe("You don't have permission to adjust stock.");
  });

  it("returns null for an unmapped RPC message", () => {
    expect(
      mapInventoryAdjustmentError({
        message: "Ingredient not found: abc",
      }),
    ).toBeNull();
  });
});

describe("inventoryAdjustmentService.recordAdjustment", () => {
  beforeEach(() => {
    supabaseMock.rpc.mockReset();
  });

  it("rejects an empty ingredient id without calling the RPC", async () => {
    const result = await inventoryAdjustmentService.recordAdjustment({
      ingredientId: "   ",
      direction: "increase",
      quantity: 1,
      reason: "physical_count",
      note: null,
    });

    expect(result.error).toBe("Select an ingredient to adjust.");
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it("rejects an invalid direction without calling the RPC", async () => {
    const result = await inventoryAdjustmentService.recordAdjustment({
      ingredientId: "ing-1",
      direction: "sideways" as never,
      quantity: 1,
      reason: "physical_count",
      note: null,
    });

    expect(result.error).toBe(
      "Choose whether to increase or decrease stock.",
    );
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it("rejects a zero quantity without calling the RPC", async () => {
    const result = await inventoryAdjustmentService.recordAdjustment({
      ingredientId: "ing-1",
      direction: "increase",
      quantity: 0,
      reason: "physical_count",
      note: null,
    });

    expect(result.error).toBe(
      "Adjustment quantity must be greater than zero.",
    );
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it("rejects an invalid reason without calling the RPC", async () => {
    const result = await inventoryAdjustmentService.recordAdjustment({
      ingredientId: "ing-1",
      direction: "increase",
      quantity: 1,
      reason: "spoilage" as never,
      note: null,
    });

    expect(result.error).toBe("Adjustment reason is invalid.");
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it("records an increase through record_inventory_adjustment", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: {
        id: "adj-1",
        movement_id: "mov-1",
        current_stock: 15,
      },
      error: null,
    });

    const result = await inventoryAdjustmentService.recordAdjustment({
      ingredientId: "ing-1",
      direction: "increase",
      quantity: 5,
      reason: "opening_stock",
      note: "  First count  ",
    });

    expect(supabaseMock.rpc).toHaveBeenCalledWith(
      "record_inventory_adjustment",
      {
        p_ingredient_id: "ing-1",
        p_direction: "increase",
        p_quantity: 5,
        p_reason: "opening_stock",
        p_note: "First count",
      },
    );
    expect(result.error).toBeNull();
    expect(result.data).toEqual({
      id: "adj-1",
      movement_id: "mov-1",
      current_stock: 15,
    });
  });

  it("maps a below-zero RPC error for the banner", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message:
          'Cannot decrease stock below zero for "Flour". Requested 8, available 3.',
      },
    });

    const result = await inventoryAdjustmentService.recordAdjustment({
      ingredientId: "ing-flour",
      direction: "decrease",
      quantity: 8,
      reason: "physical_count",
      note: null,
    });

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "Not enough stock for this decrease. Available: 3.",
    );
  });

  it("maps a permission RPC error for the banner", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message: "Insufficient permissions for this action (role: seller).",
      },
    });

    const result = await inventoryAdjustmentService.recordAdjustment({
      ingredientId: "ing-1",
      direction: "increase",
      quantity: 1,
      reason: "other",
      note: null,
    });

    expect(result.error).toBe("You don't have permission to adjust stock.");
  });

  it("passes through an unmapped RPC message", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: { message: "Ingredient not found: missing" },
    });

    const result = await inventoryAdjustmentService.recordAdjustment({
      ingredientId: "missing",
      direction: "increase",
      quantity: 1,
      reason: "other",
      note: null,
    });

    expect(result.error).toBe("Ingredient not found: missing");
  });
});
