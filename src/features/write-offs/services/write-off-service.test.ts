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
      { id: "recipe-apple", name: "Apple Crepe" },
      { id: "recipe-crepe", name: "Chicken Crepe" },
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
