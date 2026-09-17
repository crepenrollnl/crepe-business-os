/**
 * POS Sale tiles rank by sold quantity; recipe load still owns the list error.
 *
 * Also covers usePosSale's client_request_id idempotency token (sql/118,
 * audit finding #9): generated once per checkout attempt, reused across a
 * failed retry (so a duplicate request never creates a second sale),
 * invalidated by any cart change before submission, and replaced by a
 * fresh one for the next sale after a successful confirm.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RecipeListItem } from "@/features/recipes/types/recipe";
import type { SaleWithLines } from "@/features/sales/types/sale";

const {
  getRecipesMock,
  getSoldQuantityByProductIdMock,
  getCurrentAccountingContextMock,
  createAndConfirmSaleMock,
  createAndConfirmSaleAndPostJournalsMock,
  markSaleQueuedMock,
} = vi.hoisted(() => ({
  getRecipesMock: vi.fn(),
  getSoldQuantityByProductIdMock: vi.fn(),
  getCurrentAccountingContextMock: vi.fn(),
  createAndConfirmSaleMock: vi.fn(),
  createAndConfirmSaleAndPostJournalsMock: vi.fn(),
  markSaleQueuedMock: vi.fn(),
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
  salesService: {
    createAndConfirmSale: (...args: unknown[]) =>
      createAndConfirmSaleMock(...args),
    createAndConfirmSaleAndPostJournals: (...args: unknown[]) =>
      createAndConfirmSaleAndPostJournalsMock(...args),
    markSaleQueued: (...args: unknown[]) => markSaleQueuedMock(...args),
  },
}));

vi.mock("@/features/accounting/services/accounting-context-service", () => ({
  accountingContextService: {
    getCurrentAccountingContext: (...args: unknown[]) =>
      getCurrentAccountingContextMock(...args),
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

const TOKEN_TEST_PRODUCT = {
  id: "recipe-1",
  name: "Nutella Crepe",
  selling_price: 5,
  image_url: null,
};

function confirmedSale(id: string): { sale: SaleWithLines; total_cogs: number } {
  return {
    sale: {
      id,
      sale_number: "S-000001",
      customer_id: null,
      status: "confirmed",
      sale_date: "2026-09-14",
      confirmed_at: "2026-09-14T10:00:00.000Z",
      paid_at: null,
      cancelled_at: null,
      fulfilled_at: null,
      is_paid: false,
      subtotal: 5,
      tax_total: 0,
      total: 5,
      notes: null,
      kitchen_note: null,
      created_at: "2026-09-14T10:00:00.000Z",
      lines: [],
    },
    total_cogs: 2,
  };
}

describe("usePosSale client_request_id (sql/118)", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    getRecipesMock.mockResolvedValue({
      data: [
        recipe({
          id: TOKEN_TEST_PRODUCT.id,
          name: TOKEN_TEST_PRODUCT.name,
          selling_price: TOKEN_TEST_PRODUCT.selling_price,
        }),
      ],
      error: null,
    });
    getSoldQuantityByProductIdMock.mockResolvedValue({
      data: new Map<string, number>(),
      error: null,
    });
    // Force the fallback (non-posting) createAndConfirmSale path so these
    // tests only need to mock one RPC wrapper.
    getCurrentAccountingContextMock.mockResolvedValue({
      data: null,
      error: "Accounting not configured.",
    });
  });

  async function setupCartWithOneItem() {
    const { result } = renderHook(() => usePosSale());

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.addToCart(TOKEN_TEST_PRODUCT);
    });

    return result;
  }

  it("generates one token and reuses it across a failed retry", async () => {
    const result = await setupCartWithOneItem();

    createAndConfirmSaleMock.mockResolvedValueOnce({
      data: null,
      error: "Network error. Please check your connection and try again.",
    });

    await act(async () => {
      await result.current.confirm();
    });

    expect(createAndConfirmSaleMock).toHaveBeenCalledTimes(1);
    const firstToken = createAndConfirmSaleMock.mock.calls[0][0]
      .client_request_id as string;
    expect(typeof firstToken).toBe("string");
    expect(firstToken.length).toBeGreaterThan(0);

    createAndConfirmSaleMock.mockResolvedValueOnce({
      data: confirmedSale("sale-1"),
      error: null,
    });

    await act(async () => {
      await result.current.confirm();
    });

    expect(createAndConfirmSaleMock).toHaveBeenCalledTimes(2);
    const secondToken = createAndConfirmSaleMock.mock.calls[1][0]
      .client_request_id as string;
    expect(secondToken).toBe(firstToken);
  });

  it("uses a fresh token for the next sale after a success", async () => {
    const result = await setupCartWithOneItem();

    createAndConfirmSaleMock.mockResolvedValueOnce({
      data: confirmedSale("sale-1"),
      error: null,
    });

    await act(async () => {
      await result.current.confirm();
    });

    const firstToken = createAndConfirmSaleMock.mock.calls[0][0]
      .client_request_id as string;

    act(() => {
      result.current.addToCart(TOKEN_TEST_PRODUCT);
    });

    createAndConfirmSaleMock.mockResolvedValueOnce({
      data: confirmedSale("sale-2"),
      error: null,
    });

    await act(async () => {
      await result.current.confirm();
    });

    const secondToken = createAndConfirmSaleMock.mock.calls[1][0]
      .client_request_id as string;

    expect(secondToken).not.toBe(firstToken);
  });

  it("invalidates the pending token when the cart changes before a retry", async () => {
    const result = await setupCartWithOneItem();

    createAndConfirmSaleMock.mockResolvedValueOnce({
      data: null,
      error: "boom",
    });

    await act(async () => {
      await result.current.confirm();
    });

    const firstToken = createAndConfirmSaleMock.mock.calls[0][0]
      .client_request_id as string;

    act(() => {
      result.current.incrementLine(TOKEN_TEST_PRODUCT.id);
    });

    createAndConfirmSaleMock.mockResolvedValueOnce({
      data: confirmedSale("sale-3"),
      error: null,
    });

    await act(async () => {
      await result.current.confirm();
    });

    const secondToken = createAndConfirmSaleMock.mock.calls[1][0]
      .client_request_id as string;

    expect(secondToken).not.toBe(firstToken);
  });
});
