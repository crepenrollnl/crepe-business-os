import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FinishedGoodsListRow } from "@/features/finished-goods/types/finished-good";
import { ok, fail } from "@/types/service";

const { supabaseMock, listProductAvailability } = vi.hoisted(() => ({
  supabaseMock: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
  listProductAvailability: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: supabaseMock,
}));

vi.mock("@/features/finished-goods/services/finished-goods-list-service", () => ({
  finishedGoodsListService: {
    listProductAvailability: (...args: unknown[]) =>
      listProductAvailability(...args),
  },
}));

import { writeOffService } from "./write-off-service";

describe("writeOffService.recordWriteOff", () => {
  beforeEach(() => {
    supabaseMock.rpc.mockReset();
  });

  it("rejects an invalid item type without calling the RPC", async () => {
    const result = await writeOffService.recordWriteOff({
      itemType: "widget" as never,
      ingredientId: "ing-1",
      productId: null,
      quantity: 1,
      reason: "spoilage",
      note: null,
    });

    expect(result.error).toBe(
      "Write-off item type must be ingredient or finished good.",
    );
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it("rejects a zero quantity without calling the RPC", async () => {
    const result = await writeOffService.recordWriteOff({
      itemType: "ingredient",
      ingredientId: "ing-1",
      productId: null,
      quantity: 0,
      reason: "spoilage",
      note: null,
    });

    expect(result.error).toBe("Write-off quantity must be greater than zero.");
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it("records an ingredient write-off through record_write_off", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: { id: "wo-1", item_type: "ingredient", total_value: 15 },
      error: null,
    });

    const result = await writeOffService.recordWriteOff({
      itemType: "ingredient",
      ingredientId: "ing-1",
      productId: null,
      quantity: 3,
      reason: "spoilage",
      note: "Fridge failed",
    });

    expect(supabaseMock.rpc).toHaveBeenCalledWith("record_write_off", {
      p_item_type: "ingredient",
      p_ingredient_id: "ing-1",
      p_product_id: null,
      p_quantity: 3,
      p_reason: "spoilage",
      p_note: "Fridge failed",
    });
    expect(result.error).toBeNull();
    expect(result.data).toEqual({
      id: "wo-1",
      item_type: "ingredient",
      total_value: 15,
    });
  });

  it("records a finished-good write-off through record_write_off", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: { id: "wo-2", item_type: "finished_good", total_value: 40 },
      error: null,
    });

    const result = await writeOffService.recordWriteOff({
      itemType: "finished_good",
      ingredientId: null,
      productId: "recipe-1",
      quantity: 2,
      reason: "quality_reject",
      note: null,
    });

    expect(supabaseMock.rpc).toHaveBeenCalledWith("record_write_off", {
      p_item_type: "finished_good",
      p_ingredient_id: null,
      p_product_id: "recipe-1",
      p_quantity: 2,
      p_reason: "quality_reject",
      p_note: null,
    });
    expect(result.error).toBeNull();
    expect(result.data?.item_type).toBe("finished_good");
  });

  it("surfaces insufficient stock from the RPC", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message: 'Insufficient stock for "Chicken". Required 5, available 1.',
      },
    });

    const result = await writeOffService.recordWriteOff({
      itemType: "ingredient",
      ingredientId: "ing-chicken",
      productId: null,
      quantity: 5,
      reason: "theft",
      note: null,
    });

    expect(result.error).toContain("Insufficient stock");
    expect(result.data).toBeNull();
  });

  it("surfaces a zero-cost ingredient RAISE from the RPC verbatim", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message:
          'Cannot record write-off. Ingredient "X" has no unit cost set. Set Cost per unit in Inventory and try again.',
      },
    });

    const result = await writeOffService.recordWriteOff({
      itemType: "ingredient",
      ingredientId: "ing-x",
      productId: null,
      quantity: 1,
      reason: "spoilage",
      note: null,
    });

    expect(result.error).toBe(
      'Cannot record write-off. Ingredient "X" has no unit cost set. Set Cost per unit in Inventory and try again.',
    );
    expect(result.data).toBeNull();
  });

  it("surfaces a zero-cost finished-good FIFO RAISE from the RPC verbatim", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message:
          'Cannot record write-off. Product "Y" was allocated from a batch with no unit cost. This cannot be fixed in Inventory — produce a new batch with a valid cost, or resolve the existing batch cost separately.',
      },
    });

    const result = await writeOffService.recordWriteOff({
      itemType: "finished_good",
      ingredientId: null,
      productId: "recipe-y",
      quantity: 1,
      reason: "spoilage",
      note: null,
    });

    expect(result.error).toBe(
      'Cannot record write-off. Product "Y" was allocated from a batch with no unit cost. This cannot be fixed in Inventory — produce a new batch with a valid cost, or resolve the existing batch cost separately.',
    );
    expect(result.data).toBeNull();
  });
});

function fgRow(
  overrides: Partial<FinishedGoodsListRow> &
    Pick<FinishedGoodsListRow, "product_id" | "product_name" | "available_quantity">,
): FinishedGoodsListRow {
  return {
    yield_unit: "pcs",
    average_unit_cost: 1,
    remaining_value: overrides.available_quantity,
    newest_batch_at: "2026-09-01T00:00:00.000Z",
    production_status:
      overrides.available_quantity > 0 ? "available" : "out_of_stock",
    ...overrides,
  };
}

describe("writeOffService.listProductOptions", () => {
  beforeEach(() => {
    listProductAvailability.mockReset();
  });

  it("maps Finished Goods availability to id/name and drops zero remaining", async () => {
    listProductAvailability.mockResolvedValue(
      ok([
        fgRow({
          product_id: "recipe-crepe",
          product_name: "Chicken Crepe",
          available_quantity: 4,
        }),
        fgRow({
          product_id: "recipe-wrapper",
          product_name: "Cucumber, sliced",
          available_quantity: 0,
        }),
        fgRow({
          product_id: "recipe-apple",
          product_name: "Apple Crepe",
          available_quantity: 2,
        }),
      ]),
    );

    const result = await writeOffService.listProductOptions();

    expect(result.error).toBeNull();
    expect(result.data).toEqual([
      { id: "recipe-apple", name: "Apple Crepe", unit: "pcs" },
      { id: "recipe-crepe", name: "Chicken Crepe", unit: "pcs" },
    ]);
  });

  it("passes through a null yield_unit as-is", async () => {
    listProductAvailability.mockResolvedValue(
      ok([
        fgRow({
          product_id: "recipe-crepe",
          product_name: "Chicken Crepe",
          available_quantity: 4,
          yield_unit: null,
        }),
      ]),
    );

    const result = await writeOffService.listProductOptions();

    expect(result.data).toEqual([
      { id: "recipe-crepe", name: "Chicken Crepe", unit: null },
    ]);
  });

  it("propagates a Finished Goods list error", async () => {
    listProductAvailability.mockResolvedValue(
      fail("Failed to load finished goods summary"),
    );

    const result = await writeOffService.listProductOptions();

    expect(result.data).toBeNull();
    expect(result.error).toBe("Failed to load finished goods summary");
  });
});

describe("writeOffService.recordDishWriteOff", () => {
  beforeEach(() => {
    supabaseMock.rpc.mockReset();
  });

  const dishInput = {
    productId: "dish-1",
    quantity: 2,
    reason: "spoilage" as const,
    note: "  burned  ",
  };

  it("calls record_dish_write_off with the exact arguments and a trimmed note", async () => {
    const rpcResult = {
      product_id: "dish-1",
      quantity: 2,
      total_value: 3.5,
      write_offs: [
        { id: "wo-1", item_type: "ingredient", total_value: 1.5 },
        { id: "wo-2", item_type: "finished_good", total_value: 2 },
      ],
    };
    supabaseMock.rpc.mockResolvedValue({ data: rpcResult, error: null });

    const result = await writeOffService.recordDishWriteOff(dishInput);

    expect(supabaseMock.rpc).toHaveBeenCalledWith("record_dish_write_off", {
      p_product_id: "dish-1",
      p_quantity: 2,
      p_reason: "spoilage",
      p_note: "burned",
    });
    expect(result.error).toBeNull();
    expect(result.data).toEqual(rpcResult);
  });

  it("sends a blank note as null", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: { product_id: "dish-1", quantity: 1, total_value: 0, write_offs: [] },
      error: null,
    });

    await writeOffService.recordDishWriteOff({ ...dishInput, quantity: 1, note: "   " });
    await writeOffService.recordDishWriteOff({ ...dishInput, quantity: 1, note: null });

    expect(supabaseMock.rpc.mock.calls.map((call) => call[1].p_note)).toEqual([null, null]);
  });

  it.each([
    ["quantity 0", { quantity: 0 }, "Write-off quantity must be greater than zero."],
    ["quantity 1000.001", { quantity: 1000.001 }, "Dish quantity must be at most 1000."],
    ["quantity NaN", { quantity: Number.NaN }, "Write-off quantity must be greater than zero."],
    ["quantity Infinity", { quantity: Number.POSITIVE_INFINITY }, "Write-off quantity must be greater than zero."],
    ["an empty product id", { productId: "  " }, "Select a dish to write off."],
    ["a bad reason", { reason: "lost" as never }, "Write-off reason is invalid."],
  ])("rejects %s without calling the RPC", async (_name, overrides, message) => {
    const result = await writeOffService.recordDishWriteOff({ ...dishInput, ...overrides });

    expect(result.error).toBe(message);
    expect(result.data).toBeNull();
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it("accepts exactly 1000", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: { product_id: "dish-1", quantity: 1000, total_value: 0, write_offs: [] },
      error: null,
    });

    const result = await writeOffService.recordDishWriteOff({ ...dishInput, quantity: 1000 });

    expect(result.error).toBeNull();
    expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
  });

  it("surfaces an RPC error message verbatim", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message:
          'Could not write off "Nutella" for dish "Crepe Nutella": Insufficient stock for Nutella.',
      },
    });

    const result = await writeOffService.recordDishWriteOff(dishInput);

    expect(result.error).toBe(
      'Could not write off "Nutella" for dish "Crepe Nutella": Insufficient stock for Nutella.',
    );
    expect(result.data).toBeNull();
  });
});

describe("writeOffService.listDishOptions", () => {
  beforeEach(() => {
    supabaseMock.from.mockReset();
  });

  it("lists active assembly recipes by name", async () => {
    const order = vi.fn().mockResolvedValue({
      data: [
        { id: "dish-1", name: "Crepe Nutella" },
        { id: "dish-2", name: "Crepe Salmon" },
      ],
      error: null,
    });
    const isActive = vi.fn(() => ({ order }));
    const role = vi.fn(() => ({ eq: isActive }));
    const select = vi.fn(() => ({ eq: role }));
    supabaseMock.from.mockReturnValue({ select });

    const result = await writeOffService.listDishOptions();

    expect(supabaseMock.from).toHaveBeenCalledWith("recipes");
    expect(select).toHaveBeenCalledWith("id, name");
    expect(role).toHaveBeenCalledWith("recipe_role", "assembly");
    expect(isActive).toHaveBeenCalledWith("is_active", true);
    expect(order).toHaveBeenCalledWith("name");
    expect(result.data).toEqual([
      { id: "dish-1", name: "Crepe Nutella" },
      { id: "dish-2", name: "Crepe Salmon" },
    ]);
  });

  it("returns an error when the query fails", async () => {
    const order = vi.fn().mockResolvedValue({ data: null, error: { message: "denied" } });
    supabaseMock.from.mockReturnValue({
      select: () => ({ eq: () => ({ eq: () => ({ order }) }) }),
    });

    const result = await writeOffService.listDishOptions();

    expect(result.data).toBeNull();
    expect(result.error).toBeTruthy();
  });
});
