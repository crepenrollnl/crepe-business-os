/**
 * Service-level coverage for inventoryMovementHistoryService (DEV-062).
 *
 * Reads must go only through get_inventory_movement_history /
 * get_inventory_movement_history_by_ingredient RPCs.
 * The service must not query tables directly, recalculate quantities, cache,
 * or write data.
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

import { inventoryMovementHistoryService } from "./inventory-movement-history-service";
import type { InventoryMovementHistory } from "../types/inventory-movement-history";

const MOVEMENT_ID = "11111111-1111-4111-8111-111111111111";
const MOVEMENT_ID_2 = "22222222-2222-4222-8222-222222222222";
const INGREDIENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const INGREDIENT_ID_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SOURCE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SOURCE_ID_2 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const insertMock = vi.fn();
const updateMock = vi.fn();
const deleteMock = vi.fn();

function historyRow(overrides?: Record<string, unknown>) {
  return {
    movement_id: MOVEMENT_ID,
    ingredient_id: INGREDIENT_ID,
    ingredient_name: "Flour",
    movement_type: "purchase_in",
    quantity: "10.000",
    unit: "kg",
    source_type: "purchase",
    source_id: SOURCE_ID,
    occurred_at: "2026-07-25T16:00:00.000Z",
    ...overrides,
  };
}

function mappedHistory(
  overrides?: Partial<InventoryMovementHistory>,
): InventoryMovementHistory {
  return {
    movement_id: MOVEMENT_ID,
    ingredient_id: INGREDIENT_ID,
    ingredient_name: "Flour",
    movement_type: "purchase_in",
    quantity: 10,
    unit: "kg",
    source_type: "purchase",
    source_id: SOURCE_ID,
    occurred_at: "2026-07-25T16:00:00.000Z",
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

describe("inventoryMovementHistoryService.getInventoryMovementHistory (DEV-062)", () => {
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

  it("retrieves inventory movement history list successfully via get_inventory_movement_history", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [
        historyRow({
          movement_id: MOVEMENT_ID_2,
          ingredient_id: INGREDIENT_ID_2,
          ingredient_name: "Butter",
          movement_type: "production_out",
          quantity: "5.000",
          unit: "kg",
          source_type: "production_session",
          source_id: SOURCE_ID_2,
          occurred_at: "2026-07-26T10:00:00.000Z",
        }),
        historyRow(),
      ],
      error: null,
    });

    const result =
      await inventoryMovementHistoryService.getInventoryMovementHistory();

    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(2);
    expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
    expect(supabaseMock.rpc).toHaveBeenCalledWith(
      "get_inventory_movement_history",
    );
    expectReadOnly("get_inventory_movement_history");
  });

  it("returns an empty array when history is empty", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [],
      error: null,
    });

    const result =
      await inventoryMovementHistoryService.getInventoryMovementHistory();

    expect(result.error).toBeNull();
    expect(result.data).toEqual([] satisfies InventoryMovementHistory[]);
    expectReadOnly("get_inventory_movement_history");
  });

  it("maps RPC rows to typed InventoryMovementHistory DTOs", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [
        historyRow({
          ingredient_name: "Milk",
          movement_type: "purchase_in",
          quantity: "8.500",
          unit: "L",
          source_type: "purchase",
          source_id: SOURCE_ID,
          occurred_at: "2026-07-24T12:00:00.000Z",
        }),
      ],
      error: null,
    });

    const result =
      await inventoryMovementHistoryService.getInventoryMovementHistory();

    expect(result.error).toBeNull();
    expect(result.data).toEqual([
      mappedHistory({
        ingredient_name: "Milk",
        movement_type: "purchase_in",
        quantity: 8.5,
        unit: "L",
        source_type: "purchase",
        source_id: SOURCE_ID,
        occurred_at: "2026-07-24T12:00:00.000Z",
      }),
    ] satisfies InventoryMovementHistory[]);
    expectReadOnly("get_inventory_movement_history");
  });

  it("maps movement_type from SQL without transformation", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [
        historyRow({
          movement_type: "production_out",
          quantity: "3.000",
        }),
        historyRow({
          movement_id: MOVEMENT_ID_2,
          movement_type: "sale_out",
          quantity: "1.000",
        }),
      ],
      error: null,
    });

    const result =
      await inventoryMovementHistoryService.getInventoryMovementHistory();

    expect(result.error).toBeNull();
    expect(result.data?.[0]?.movement_type).toBe("production_out");
    expect(result.data?.[1]?.movement_type).toBe("sale_out");
    expectReadOnly("get_inventory_movement_history");
  });

  it("maps source_type and source_id from SQL including null source_id", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [
        historyRow({
          source_type: "production_session",
          source_id: SOURCE_ID_2,
        }),
        historyRow({
          movement_id: MOVEMENT_ID_2,
          source_type: "manual",
          source_id: null,
        }),
      ],
      error: null,
    });

    const result =
      await inventoryMovementHistoryService.getInventoryMovementHistory();

    expect(result.error).toBeNull();
    expect(result.data?.[0]?.source_type).toBe("production_session");
    expect(result.data?.[0]?.source_id).toBe(SOURCE_ID_2);
    expect(result.data?.[1]?.source_type).toBe("manual");
    expect(result.data?.[1]?.source_id).toBeNull();
    expectReadOnly("get_inventory_movement_history");
  });

  it("maps missing get_inventory_movement_history function errors", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message:
          "Could not find the function public.get_inventory_movement_history",
      },
    });

    const result =
      await inventoryMovementHistoryService.getInventoryMovementHistory();

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "Inventory movement history is not available yet. Apply the inventory movement history database script and try again.",
    );
    expectNoDirectWrites();
  });

  it("rejects invalid list payloads", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: { not: "an-array" },
      error: null,
    });

    const result =
      await inventoryMovementHistoryService.getInventoryMovementHistory();

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "Inventory movement history response was invalid.",
    );
    expectNoDirectWrites();
  });

  it("is read-only and never writes tables", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [historyRow()],
      error: null,
    });

    await inventoryMovementHistoryService.getInventoryMovementHistory();

    expectReadOnly("get_inventory_movement_history");
  });

  it("never queries inventory movement tables directly", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [historyRow()],
      error: null,
    });

    await inventoryMovementHistoryService.getInventoryMovementHistory();

    expect(supabaseMock.from).not.toHaveBeenCalledWith(
      "inventory_movement_history",
    );
    expect(supabaseMock.from).not.toHaveBeenCalledWith("stock_movements");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("purchases");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("purchase_items");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("ingredients");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("sales");
    expectNoDirectWrites();
  });
});

describe("inventoryMovementHistoryService.getInventoryMovementHistoryByIngredient (DEV-062)", () => {
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

  it("retrieves history by ingredient successfully via get_inventory_movement_history_by_ingredient", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [
        historyRow({
          movement_type: "production_out",
          quantity: "12.000",
          source_type: "production_session",
          source_id: SOURCE_ID_2,
          occurred_at: "2026-07-26T10:00:00.000Z",
        }),
        historyRow({
          movement_id: MOVEMENT_ID_2,
          movement_type: "purchase_in",
          quantity: "4.000",
          source_type: "purchase",
          source_id: SOURCE_ID,
          occurred_at: "2026-07-20T08:00:00.000Z",
        }),
      ],
      error: null,
    });

    const result =
      await inventoryMovementHistoryService.getInventoryMovementHistoryByIngredient(
        INGREDIENT_ID,
      );

    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(2);
    expect(result.data?.[0]).toEqual(
      mappedHistory({
        movement_type: "production_out",
        quantity: 12,
        source_type: "production_session",
        source_id: SOURCE_ID_2,
        occurred_at: "2026-07-26T10:00:00.000Z",
      }) satisfies InventoryMovementHistory,
    );
    expect(supabaseMock.rpc).toHaveBeenCalledWith(
      "get_inventory_movement_history_by_ingredient",
      {
        p_ingredient_id: INGREDIENT_ID,
      },
    );
    expectReadOnly("get_inventory_movement_history_by_ingredient");
  });

  it("returns an empty array when ingredient has no history", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [],
      error: null,
    });

    const result =
      await inventoryMovementHistoryService.getInventoryMovementHistoryByIngredient(
        INGREDIENT_ID,
      );

    expect(result.error).toBeNull();
    expect(result.data).toEqual([] satisfies InventoryMovementHistory[]);
    expectReadOnly("get_inventory_movement_history_by_ingredient");
  });

  it("maps movement_type, source_type, and source_id for one ingredient", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [
        historyRow({
          movement_type: "adjustment",
          quantity: "50.000",
          unit: "g",
          source_type: "manual",
          source_id: null,
        }),
      ],
      error: null,
    });

    const result =
      await inventoryMovementHistoryService.getInventoryMovementHistoryByIngredient(
        `  ${INGREDIENT_ID}  `,
      );

    expect(result.error).toBeNull();
    expect(result.data?.[0]?.movement_type).toBe("adjustment");
    expect(result.data?.[0]?.source_type).toBe("manual");
    expect(result.data?.[0]?.source_id).toBeNull();
    expect(result.data?.[0]?.quantity).toBe(50);
    expect(result.data?.[0]?.unit).toBe("g");
    expect(supabaseMock.rpc).toHaveBeenCalledWith(
      "get_inventory_movement_history_by_ingredient",
      {
        p_ingredient_id: INGREDIENT_ID,
      },
    );
    expectReadOnly("get_inventory_movement_history_by_ingredient");
  });

  it("rejects invalid ingredient id without calling the RPC", async () => {
    const blank =
      await inventoryMovementHistoryService.getInventoryMovementHistoryByIngredient(
        "   ",
      );
    expect(blank.data).toBeNull();
    expect(blank.error).toBe("Ingredient id is required.");

    const invalid =
      await inventoryMovementHistoryService.getInventoryMovementHistoryByIngredient(
        "not-a-uuid",
      );
    expect(invalid.data).toBeNull();
    expect(invalid.error).toBe("Ingredient id is required.");

    expect(supabaseMock.rpc).not.toHaveBeenCalled();
    expectNoDirectWrites();
  });

  it("maps missing get_inventory_movement_history_by_ingredient function errors", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message:
          "Could not find the function public.get_inventory_movement_history_by_ingredient",
      },
    });

    const result =
      await inventoryMovementHistoryService.getInventoryMovementHistoryByIngredient(
        INGREDIENT_ID,
      );

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "Inventory movement history is not available yet. Apply the inventory movement history database script and try again.",
    );
    expectNoDirectWrites();
  });

  it("maps missing inventory_movement_history relation errors", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message: 'relation "inventory_movement_history" does not exist',
        code: "42P01",
      },
    });

    const result =
      await inventoryMovementHistoryService.getInventoryMovementHistoryByIngredient(
        INGREDIENT_ID,
      );

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "Inventory movement history is not available yet. Apply the inventory movement history database script and try again.",
    );
    expectNoDirectWrites();
  });

  it("rejects invalid history payloads", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [historyRow({ ingredient_id: "not-a-uuid" })],
      error: null,
    });

    const result =
      await inventoryMovementHistoryService.getInventoryMovementHistoryByIngredient(
        INGREDIENT_ID,
      );

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "Inventory movement history response was invalid.",
    );
    expectNoDirectWrites();
  });

  it("is read-only and never writes tables", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [historyRow()],
      error: null,
    });

    await inventoryMovementHistoryService.getInventoryMovementHistoryByIngredient(
      INGREDIENT_ID,
    );

    expectReadOnly("get_inventory_movement_history_by_ingredient");
  });
});
