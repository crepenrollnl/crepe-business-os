/**
 * Service-level coverage for inventoryValuationService (DEV-058).
 *
 * Reads must go only through get_inventory_valuation /
 * get_inventory_item_value RPCs.
 * The service must not query tables directly, recalculate stock values,
 * cache, or write data.
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

import { inventoryValuationService } from "./inventory-valuation-service";
import type { InventoryValuation } from "../types/inventory-valuation";

const INGREDIENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const INGREDIENT_ID_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const insertMock = vi.fn();
const updateMock = vi.fn();
const deleteMock = vi.fn();

function valuationRow(overrides?: Record<string, unknown>) {
  return {
    ingredient_id: INGREDIENT_ID,
    ingredient_name: "Flour",
    current_quantity: "10.000",
    unit: "kg",
    average_cost: "2.5000",
    stock_value: "25.0000",
    last_purchase_date: "2026-07-25T16:00:00.000Z",
    ...overrides,
  };
}

function mappedValuation(
  overrides?: Partial<InventoryValuation>,
): InventoryValuation {
  return {
    ingredient_id: INGREDIENT_ID,
    ingredient_name: "Flour",
    current_quantity: 10,
    unit: "kg",
    average_cost: 2.5,
    stock_value: 25,
    last_purchase_date: "2026-07-25T16:00:00.000Z",
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

describe("inventoryValuationService.getInventoryValuation (DEV-058)", () => {
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

  it("retrieves inventory valuation list successfully via get_inventory_valuation", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [
        valuationRow({
          ingredient_id: INGREDIENT_ID_2,
          ingredient_name: "Butter",
          current_quantity: "5.000",
          average_cost: "4.0000",
          stock_value: "20.0000",
        }),
        valuationRow(),
      ],
      error: null,
    });

    const result = await inventoryValuationService.getInventoryValuation();

    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(2);
    expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
    expect(supabaseMock.rpc).toHaveBeenCalledWith("get_inventory_valuation");
    expectReadOnly("get_inventory_valuation");
  });

  it("returns an empty array when no ingredients exist", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [],
      error: null,
    });

    const result = await inventoryValuationService.getInventoryValuation();

    expect(result.error).toBeNull();
    expect(result.data).toEqual([] satisfies InventoryValuation[]);
    expectReadOnly("get_inventory_valuation");
  });

  it("maps RPC rows to typed InventoryValuation DTOs", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [
        valuationRow({
          ingredient_name: "Milk",
          current_quantity: "8.500",
          unit: "L",
          average_cost: "1.2000",
          stock_value: "10.2000",
          last_purchase_date: "2026-07-24T12:00:00.000Z",
        }),
      ],
      error: null,
    });

    const result = await inventoryValuationService.getInventoryValuation();

    expect(result.error).toBeNull();
    expect(result.data).toEqual([
      mappedValuation({
        ingredient_name: "Milk",
        current_quantity: 8.5,
        unit: "L",
        average_cost: 1.2,
        stock_value: 10.2,
        last_purchase_date: "2026-07-24T12:00:00.000Z",
      }),
    ] satisfies InventoryValuation[]);
    expectReadOnly("get_inventory_valuation");
  });

  it("maps stock_value from SQL without recalculation", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [
        valuationRow({
          current_quantity: "100.000",
          average_cost: "2.0000",
          stock_value: "999.9900",
        }),
      ],
      error: null,
    });

    const result = await inventoryValuationService.getInventoryValuation();

    expect(result.error).toBeNull();
    // Values come from the RPC as-is - never recomputed from qty * cost.
    expect(result.data?.[0]?.current_quantity).toBe(100);
    expect(result.data?.[0]?.average_cost).toBe(2);
    expect(result.data?.[0]?.stock_value).toBe(999.99);
    expectReadOnly("get_inventory_valuation");
  });

  it("maps null last_purchase_date without recalculation", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [valuationRow({ last_purchase_date: null })],
      error: null,
    });

    const result = await inventoryValuationService.getInventoryValuation();

    expect(result.error).toBeNull();
    expect(result.data?.[0]?.last_purchase_date).toBeNull();
    expectReadOnly("get_inventory_valuation");
  });

  it("maps missing get_inventory_valuation function errors", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message:
          "Could not find the function public.get_inventory_valuation",
      },
    });

    const result = await inventoryValuationService.getInventoryValuation();

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "Inventory valuation is not available yet. Apply the inventory valuation database script and try again.",
    );
    expectNoDirectWrites();
  });

  it("rejects invalid list payloads", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: { not: "an-array" },
      error: null,
    });

    const result = await inventoryValuationService.getInventoryValuation();

    expect(result.data).toBeNull();
    expect(result.error).toBe("Inventory valuation response was invalid.");
    expectNoDirectWrites();
  });

  it("is read-only and never writes tables", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [valuationRow()],
      error: null,
    });

    await inventoryValuationService.getInventoryValuation();

    expectReadOnly("get_inventory_valuation");
  });

  it("never queries ingredients or purchases tables directly", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [valuationRow()],
      error: null,
    });

    await inventoryValuationService.getInventoryValuation();

    expect(supabaseMock.from).not.toHaveBeenCalledWith("inventory_valuation");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("ingredients");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("purchases");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("purchase_items");
    expect(supabaseMock.from).not.toHaveBeenCalledWith(
      "report_inventory_summary",
    );
    expectNoDirectWrites();
  });
});

describe("inventoryValuationService.getInventoryItemValue (DEV-058)", () => {
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

  it("retrieves a single inventory item value successfully via get_inventory_item_value", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: valuationRow({
        current_quantity: "12.000",
        average_cost: "3.0000",
        stock_value: "36.0000",
      }),
      error: null,
    });

    const result =
      await inventoryValuationService.getInventoryItemValue(INGREDIENT_ID);

    expect(result.error).toBeNull();
    expect(result.data).toEqual(
      mappedValuation({
        current_quantity: 12,
        average_cost: 3,
        stock_value: 36,
      }) satisfies InventoryValuation,
    );
    expect(supabaseMock.rpc).toHaveBeenCalledWith("get_inventory_item_value", {
      p_ingredient_id: INGREDIENT_ID,
    });
    expectReadOnly("get_inventory_item_value");
  });

  it("maps stock_value for a single item without recalculation", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: valuationRow({
        current_quantity: "50.000",
        average_cost: "1.0000",
        stock_value: "77.7700",
      }),
      error: null,
    });

    const result = await inventoryValuationService.getInventoryItemValue(
      `  ${INGREDIENT_ID}  `,
    );

    expect(result.error).toBeNull();
    expect(result.data?.stock_value).toBe(77.77);
    expect(result.data?.current_quantity).toBe(50);
    expect(result.data?.average_cost).toBe(1);
    expect(supabaseMock.rpc).toHaveBeenCalledWith("get_inventory_item_value", {
      p_ingredient_id: INGREDIENT_ID,
    });
    expectReadOnly("get_inventory_item_value");
  });

  it("rejects invalid ingredient id without calling the RPC", async () => {
    const blank = await inventoryValuationService.getInventoryItemValue("   ");
    expect(blank.data).toBeNull();
    expect(blank.error).toBe("Ingredient id is required.");

    const invalid =
      await inventoryValuationService.getInventoryItemValue("not-a-uuid");
    expect(invalid.data).toBeNull();
    expect(invalid.error).toBe("Ingredient id is required.");

    expect(supabaseMock.rpc).not.toHaveBeenCalled();
    expectNoDirectWrites();
  });

  it("maps missing ingredient as not found", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: null,
    });

    const result =
      await inventoryValuationService.getInventoryItemValue(INGREDIENT_ID);

    expect(result.data).toBeNull();
    expect(result.error).toBe("Inventory item value was not found.");
    expectNoDirectWrites();
  });

  it("maps missing get_inventory_item_value function errors", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message:
          "Could not find the function public.get_inventory_item_value",
      },
    });

    const result =
      await inventoryValuationService.getInventoryItemValue(INGREDIENT_ID);

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "Inventory valuation is not available yet. Apply the inventory valuation database script and try again.",
    );
    expectNoDirectWrites();
  });

  it("maps missing inventory_valuation relation errors", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message: 'relation "inventory_valuation" does not exist',
        code: "42P01",
      },
    });

    const result =
      await inventoryValuationService.getInventoryItemValue(INGREDIENT_ID);

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "Inventory valuation is not available yet. Apply the inventory valuation database script and try again.",
    );
    expectNoDirectWrites();
  });

  it("rejects invalid single-item payloads", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: valuationRow({ ingredient_id: "not-a-uuid" }),
      error: null,
    });

    const result =
      await inventoryValuationService.getInventoryItemValue(INGREDIENT_ID);

    expect(result.data).toBeNull();
    expect(result.error).toBe("Inventory item value response was invalid.");
    expectNoDirectWrites();
  });

  it("is read-only and never writes tables", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: valuationRow(),
      error: null,
    });

    await inventoryValuationService.getInventoryItemValue(INGREDIENT_ID);

    expectReadOnly("get_inventory_item_value");
  });
});
