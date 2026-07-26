/**
 * Service-level coverage for purchasePriceHistoryService (DEV-059).
 *
 * Reads must go only through get_purchase_price_history /
 * get_purchase_price_history_by_ingredient RPCs.
 * The service must not query tables directly, recalculate prices, cache,
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

import { purchasePriceHistoryService } from "./purchase-price-history-service";
import type { PurchasePriceHistory } from "../types/purchase-price-history";

const INGREDIENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const INGREDIENT_ID_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const insertMock = vi.fn();
const updateMock = vi.fn();
const deleteMock = vi.fn();

function historyRow(overrides?: Record<string, unknown>) {
  return {
    ingredient_id: INGREDIENT_ID,
    ingredient_name: "Flour",
    supplier_name: "Mill Co",
    purchase_date: "2026-07-25T16:00:00.000Z",
    quantity: "10.000",
    unit_price: "2.5000",
    total_price: "25.00",
    ...overrides,
  };
}

function mappedHistory(
  overrides?: Partial<PurchasePriceHistory>,
): PurchasePriceHistory {
  return {
    ingredient_id: INGREDIENT_ID,
    ingredient_name: "Flour",
    supplier_name: "Mill Co",
    purchase_date: "2026-07-25T16:00:00.000Z",
    quantity: 10,
    unit_price: 2.5,
    total_price: 25,
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

describe("purchasePriceHistoryService.getPurchasePriceHistory (DEV-059)", () => {
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

  it("retrieves purchase price history list successfully via get_purchase_price_history", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [
        historyRow({
          ingredient_id: INGREDIENT_ID_2,
          ingredient_name: "Butter",
          supplier_name: "Dairy Farm",
          purchase_date: "2026-07-26T10:00:00.000Z",
          quantity: "5.000",
          unit_price: "4.0000",
          total_price: "20.00",
        }),
        historyRow(),
      ],
      error: null,
    });

    const result = await purchasePriceHistoryService.getPurchasePriceHistory();

    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(2);
    expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
    expect(supabaseMock.rpc).toHaveBeenCalledWith("get_purchase_price_history");
    expectReadOnly("get_purchase_price_history");
  });

  it("returns an empty array when history is empty", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [],
      error: null,
    });

    const result = await purchasePriceHistoryService.getPurchasePriceHistory();

    expect(result.error).toBeNull();
    expect(result.data).toEqual([] satisfies PurchasePriceHistory[]);
    expectReadOnly("get_purchase_price_history");
  });

  it("maps RPC rows to typed PurchasePriceHistory DTOs", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [
        historyRow({
          ingredient_name: "Milk",
          supplier_name: "Fresh Dairy",
          purchase_date: "2026-07-24T12:00:00.000Z",
          quantity: "8.500",
          unit_price: "1.2000",
          total_price: "10.20",
        }),
      ],
      error: null,
    });

    const result = await purchasePriceHistoryService.getPurchasePriceHistory();

    expect(result.error).toBeNull();
    expect(result.data).toEqual([
      mappedHistory({
        ingredient_name: "Milk",
        supplier_name: "Fresh Dairy",
        purchase_date: "2026-07-24T12:00:00.000Z",
        quantity: 8.5,
        unit_price: 1.2,
        total_price: 10.2,
      }),
    ] satisfies PurchasePriceHistory[]);
    expectReadOnly("get_purchase_price_history");
  });

  it("maps unit_price and total_price from SQL without recalculation", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [
        historyRow({
          quantity: "100.000",
          unit_price: "2.0000",
          total_price: "999.99",
        }),
      ],
      error: null,
    });

    const result = await purchasePriceHistoryService.getPurchasePriceHistory();

    expect(result.error).toBeNull();
    // Values come from the RPC as-is - never recomputed from qty * unit_price.
    expect(result.data?.[0]?.quantity).toBe(100);
    expect(result.data?.[0]?.unit_price).toBe(2);
    expect(result.data?.[0]?.total_price).toBe(999.99);
    expectReadOnly("get_purchase_price_history");
  });

  it("maps missing get_purchase_price_history function errors", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message:
          "Could not find the function public.get_purchase_price_history",
      },
    });

    const result = await purchasePriceHistoryService.getPurchasePriceHistory();

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "Purchase price history is not available yet. Apply the purchase price history database script and try again.",
    );
    expectNoDirectWrites();
  });

  it("rejects invalid list payloads", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: { not: "an-array" },
      error: null,
    });

    const result = await purchasePriceHistoryService.getPurchasePriceHistory();

    expect(result.data).toBeNull();
    expect(result.error).toBe("Purchase price history response was invalid.");
    expectNoDirectWrites();
  });

  it("is read-only and never writes tables", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [historyRow()],
      error: null,
    });

    await purchasePriceHistoryService.getPurchasePriceHistory();

    expectReadOnly("get_purchase_price_history");
  });

  it("never queries purchases or ingredients tables directly", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [historyRow()],
      error: null,
    });

    await purchasePriceHistoryService.getPurchasePriceHistory();

    expect(supabaseMock.from).not.toHaveBeenCalledWith(
      "purchase_price_history",
    );
    expect(supabaseMock.from).not.toHaveBeenCalledWith("purchases");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("purchase_items");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("ingredients");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("suppliers");
    expect(supabaseMock.from).not.toHaveBeenCalledWith(
      "report_purchase_summary",
    );
    expectNoDirectWrites();
  });
});

describe("purchasePriceHistoryService.getPurchasePriceHistoryByIngredient (DEV-059)", () => {
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

  it("retrieves history by ingredient successfully via get_purchase_price_history_by_ingredient", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [
        historyRow({
          purchase_date: "2026-07-26T10:00:00.000Z",
          quantity: "12.000",
          unit_price: "3.0000",
          total_price: "36.00",
        }),
        historyRow({
          purchase_date: "2026-07-20T08:00:00.000Z",
          quantity: "4.000",
          unit_price: "2.7500",
          total_price: "11.00",
        }),
      ],
      error: null,
    });

    const result =
      await purchasePriceHistoryService.getPurchasePriceHistoryByIngredient(
        INGREDIENT_ID,
      );

    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(2);
    expect(result.data?.[0]).toEqual(
      mappedHistory({
        purchase_date: "2026-07-26T10:00:00.000Z",
        quantity: 12,
        unit_price: 3,
        total_price: 36,
      }) satisfies PurchasePriceHistory,
    );
    expect(supabaseMock.rpc).toHaveBeenCalledWith(
      "get_purchase_price_history_by_ingredient",
      {
        p_ingredient_id: INGREDIENT_ID,
      },
    );
    expectReadOnly("get_purchase_price_history_by_ingredient");
  });

  it("returns an empty array when ingredient has no history", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [],
      error: null,
    });

    const result =
      await purchasePriceHistoryService.getPurchasePriceHistoryByIngredient(
        INGREDIENT_ID,
      );

    expect(result.error).toBeNull();
    expect(result.data).toEqual([] satisfies PurchasePriceHistory[]);
    expectReadOnly("get_purchase_price_history_by_ingredient");
  });

  it("maps unit_price and total_price for one ingredient without recalculation", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [
        historyRow({
          quantity: "50.000",
          unit_price: "1.0000",
          total_price: "77.77",
        }),
      ],
      error: null,
    });

    const result =
      await purchasePriceHistoryService.getPurchasePriceHistoryByIngredient(
        `  ${INGREDIENT_ID}  `,
      );

    expect(result.error).toBeNull();
    expect(result.data?.[0]?.unit_price).toBe(1);
    expect(result.data?.[0]?.total_price).toBe(77.77);
    expect(result.data?.[0]?.quantity).toBe(50);
    expect(supabaseMock.rpc).toHaveBeenCalledWith(
      "get_purchase_price_history_by_ingredient",
      {
        p_ingredient_id: INGREDIENT_ID,
      },
    );
    expectReadOnly("get_purchase_price_history_by_ingredient");
  });

  it("rejects invalid ingredient id without calling the RPC", async () => {
    const blank =
      await purchasePriceHistoryService.getPurchasePriceHistoryByIngredient(
        "   ",
      );
    expect(blank.data).toBeNull();
    expect(blank.error).toBe("Ingredient id is required.");

    const invalid =
      await purchasePriceHistoryService.getPurchasePriceHistoryByIngredient(
        "not-a-uuid",
      );
    expect(invalid.data).toBeNull();
    expect(invalid.error).toBe("Ingredient id is required.");

    expect(supabaseMock.rpc).not.toHaveBeenCalled();
    expectNoDirectWrites();
  });

  it("maps missing get_purchase_price_history_by_ingredient function errors", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message:
          "Could not find the function public.get_purchase_price_history_by_ingredient",
      },
    });

    const result =
      await purchasePriceHistoryService.getPurchasePriceHistoryByIngredient(
        INGREDIENT_ID,
      );

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "Purchase price history is not available yet. Apply the purchase price history database script and try again.",
    );
    expectNoDirectWrites();
  });

  it("maps missing purchase_price_history relation errors", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message: 'relation "purchase_price_history" does not exist',
        code: "42P01",
      },
    });

    const result =
      await purchasePriceHistoryService.getPurchasePriceHistoryByIngredient(
        INGREDIENT_ID,
      );

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "Purchase price history is not available yet. Apply the purchase price history database script and try again.",
    );
    expectNoDirectWrites();
  });

  it("rejects invalid history payloads", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [historyRow({ ingredient_id: "not-a-uuid" })],
      error: null,
    });

    const result =
      await purchasePriceHistoryService.getPurchasePriceHistoryByIngredient(
        INGREDIENT_ID,
      );

    expect(result.data).toBeNull();
    expect(result.error).toBe("Purchase price history response was invalid.");
    expectNoDirectWrites();
  });

  it("is read-only and never writes tables", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [historyRow()],
      error: null,
    });

    await purchasePriceHistoryService.getPurchasePriceHistoryByIngredient(
      INGREDIENT_ID,
    );

    expectReadOnly("get_purchase_price_history_by_ingredient");
  });
});
