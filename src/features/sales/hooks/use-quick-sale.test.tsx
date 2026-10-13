/**
 * Quick Sale tiles rank by sold quantity; recipe load still owns the list error.
 *
 * Audit D3: a committed sale is success even when its reload failed, and
 * the client_request_id token (sql/118) is reused across a failed retry.
 * Audit D4: a "price changed" rejection (sql/146) re-prices the cart.
 * Audit D2/K3: confirm is the RPC only -- the database posts the journals
 * (sql/147), so the hook never loads an accounting context or posts.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RecipeListItem } from "@/features/recipes/types/recipe";
import type { ConfirmSaleResult } from "@/features/sales/types/sale";

const {
  getRecipesMock,
  getSoldQuantityByProductIdMock,
  getCurrentAccountingContextMock,
  createAndConfirmSaleMock,
  markSaleQueuedMock,
} = vi.hoisted(() => ({
  getRecipesMock: vi.fn(),
  getSoldQuantityByProductIdMock: vi.fn(),
  getCurrentAccountingContextMock: vi.fn(),
  createAndConfirmSaleMock: vi.fn(),
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
    markSaleQueued: (...args: unknown[]) => markSaleQueuedMock(...args),
  },
}));

// Kept only to prove confirm never loads an accounting context (sql/147).
vi.mock("@/features/accounting/services/accounting-context-service", () => ({
  accountingContextService: {
    getCurrentAccountingContext: (...args: unknown[]) =>
      getCurrentAccountingContextMock(...args),
  },
}));

import { useQuickSale } from "./use-quick-sale";

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

describe("useQuickSale product ranking", () => {
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
    const { result } = renderHook(() => useQuickSale());

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

    const { result } = renderHook(() => useQuickSale());

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

    const { result } = renderHook(() => useQuickSale());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.products).toEqual([]);
    expect(result.current.error).toBe("Failed to load recipes");
  });
});

describe("useQuickSale confirm without app-side posting (audit D2/K3)", () => {
  const PRODUCT = {
    id: CHICKEN_ID,
    name: "Chicken crepe",
    selling_price: 10,
    image_url: null,
  };

  function confirmedSale(id: string): ConfirmSaleResult {
    return {
      sale_id: id,
      reloadError: null,
      sale: {
        id,
        sale_number: "S-000042",
        customer_id: null,
        status: "confirmed",
        sale_date: "2026-09-14",
        confirmed_at: "2026-09-14T10:00:00.000Z",
        paid_at: null,
        cancelled_at: null,
        fulfilled_at: null,
        is_paid: false,
        subtotal: 10,
        tax_total: 0,
        total: 10,
        notes: null,
        kitchen_note: null,
        created_at: "2026-09-14T10:00:00.000Z",
        lines: [],
      },
      total_cogs: 4,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    getRecipesMock.mockResolvedValue({
      data: [recipe({ id: CHICKEN_ID, name: "Chicken crepe" })],
      error: null,
    });
    getSoldQuantityByProductIdMock.mockResolvedValue({
      data: new Map<string, number>(),
      error: null,
    });
  });

  async function confirmOneItem(options?: { sendToQueue?: boolean }) {
    const { result } = renderHook(() => useQuickSale());

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.addToCart(PRODUCT);
      if (options?.sendToQueue) {
        result.current.setSendToQueue(true);
      }
    });

    let confirmed: boolean | undefined;
    await act(async () => {
      confirmed = await result.current.confirm();
    });

    return { result, confirmed };
  }

  it("confirms through the RPC only and never loads an accounting context", async () => {
    createAndConfirmSaleMock.mockResolvedValue({
      data: confirmedSale("sale-42"),
      error: null,
    });

    const { result, confirmed } = await confirmOneItem();

    expect(confirmed).toBe(true);
    expect(createAndConfirmSaleMock).toHaveBeenCalledTimes(1);
    expect(getCurrentAccountingContextMock).not.toHaveBeenCalled();
    expect(result.current.lastConfirmedSaleNumber).toBe("S-000042");
    expect(result.current.warning).toBeNull();
    expect(result.current.actionError).toBeNull();
  });

  it("treats a committed sale whose reload failed as success and warns", async () => {
    createAndConfirmSaleMock.mockResolvedValue({
      data: {
        sale_id: "sale-44",
        sale: null,
        total_cogs: 4,
        reloadError: "Statement timeout.",
      },
      error: null,
    });

    const { result, confirmed } = await confirmOneItem();

    expect(confirmed).toBe(true);
    expect(result.current.actionError).toBeNull();
    expect(result.current.cartLines).toEqual([]);
    expect(result.current.warning).toBe(
      "Sale confirmed, but it could not be reloaded: Statement timeout.",
    );
  });

  it("queues by sale_id and shows a queue failure as a warning", async () => {
    createAndConfirmSaleMock.mockResolvedValue({
      data: {
        sale_id: "sale-45",
        sale: null,
        total_cogs: 4,
        reloadError: "Statement timeout.",
      },
      error: null,
    });
    markSaleQueuedMock.mockResolvedValue({ data: null, error: "Queue is down." });

    const { result, confirmed } = await confirmOneItem({ sendToQueue: true });

    expect(confirmed).toBe(true);
    expect(markSaleQueuedMock).toHaveBeenCalledWith("sale-45");
    expect(result.current.warning).toBe(
      "Sale confirmed, but it could not be reloaded: Statement timeout. Queue is down.",
    );
  });
});

describe("useQuickSale client_request_id (sql/118, audit D3)", () => {
  const PRODUCT = {
    id: CHICKEN_ID,
    name: "Chicken crepe",
    selling_price: 10,
    image_url: null,
  };

  function confirmed(id: string): ConfirmSaleResult {
    return { sale_id: id, sale: null, total_cogs: 4, reloadError: null };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    getRecipesMock.mockResolvedValue({
      data: [recipe({ id: CHICKEN_ID, name: "Chicken crepe" })],
      error: null,
    });
    getSoldQuantityByProductIdMock.mockResolvedValue({
      data: new Map<string, number>(),
      error: null,
    });
  });

  async function setupCart() {
    const { result } = renderHook(() => useQuickSale());
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => {
      result.current.addToCart(PRODUCT);
    });
    return result;
  }

  function tokenOf(call: number): string {
    return createAndConfirmSaleMock.mock.calls[call][0]
      .client_request_id as string;
  }

  it("sends a token and reuses it across a failed retry", async () => {
    const result = await setupCart();
    createAndConfirmSaleMock.mockResolvedValueOnce({
      data: null,
      error: "Network error. Please check your connection and try again.",
    });
    await act(async () => {
      await result.current.confirm();
    });

    createAndConfirmSaleMock.mockResolvedValueOnce({
      data: confirmed("sale-1"),
      error: null,
    });
    await act(async () => {
      await result.current.confirm();
    });

    expect(tokenOf(0)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(tokenOf(1)).toBe(tokenOf(0));
  });

  it("uses a fresh token after a success", async () => {
    const result = await setupCart();
    createAndConfirmSaleMock.mockResolvedValue({
      data: confirmed("sale-1"),
      error: null,
    });
    await act(async () => {
      await result.current.confirm();
    });
    act(() => {
      result.current.addToCart(PRODUCT);
    });
    await act(async () => {
      await result.current.confirm();
    });

    expect(tokenOf(1)).not.toBe(tokenOf(0));
  });

  it("invalidates the pending token when the cart changes before a retry", async () => {
    const result = await setupCart();
    createAndConfirmSaleMock.mockResolvedValueOnce({ data: null, error: "boom" });
    await act(async () => {
      await result.current.confirm();
    });
    act(() => {
      result.current.incrementLine(CHICKEN_ID);
    });
    createAndConfirmSaleMock.mockResolvedValueOnce({
      data: confirmed("sale-2"),
      error: null,
    });
    await act(async () => {
      await result.current.confirm();
    });

    expect(tokenOf(1)).not.toBe(tokenOf(0));
  });
});

describe("useQuickSale price change (audit D4)", () => {
  const PRODUCT = {
    id: CHICKEN_ID,
    name: "Chicken crepe",
    selling_price: 10,
    image_url: null,
  };
  const PRICE_ERROR =
    'The price of "Chicken crepe" is now €12.00. Refresh the screen and try again.';

  beforeEach(() => {
    vi.clearAllMocks();
    getRecipesMock.mockResolvedValue({
      data: [recipe({ id: CHICKEN_ID, name: "Chicken crepe" })],
      error: null,
    });
    getSoldQuantityByProductIdMock.mockResolvedValue({
      data: new Map<string, number>(),
      error: null,
    });
  });

  async function setupCart() {
    const { result } = renderHook(() => useQuickSale());
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => {
      result.current.addToCart(PRODUCT);
      result.current.addToCart(PRODUCT);
    });
    return result;
  }

  it("re-prices the cart and shows the message", async () => {
    const result = await setupCart();
    createAndConfirmSaleMock.mockResolvedValueOnce({
      data: null,
      error: PRICE_ERROR,
    });
    getRecipesMock.mockResolvedValueOnce({
      data: [recipe({ id: CHICKEN_ID, name: "Chicken crepe", selling_price: 12 })],
      error: null,
    });

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.confirm();
    });

    expect(ok).toBe(false);
    expect(result.current.actionError).toBe(PRICE_ERROR);
    expect(result.current.cartLines).toEqual([
      {
        product_id: CHICKEN_ID,
        name: "Chicken crepe",
        unit_price: 12,
        quantity: 2,
      },
    ]);
    expect(result.current.itemsTotal).toBe(24);
  });

  it("removes a product that became inactive and says so", async () => {
    const result = await setupCart();
    createAndConfirmSaleMock.mockResolvedValueOnce({
      data: null,
      error: PRICE_ERROR,
    });
    getRecipesMock.mockResolvedValueOnce({
      data: [recipe({ id: CHICKEN_ID, name: "Chicken crepe", is_active: false })],
      error: null,
    });

    await act(async () => {
      await result.current.confirm();
    });

    expect(result.current.cartLines).toEqual([]);
    expect(result.current.actionError).toBe(
      `${PRICE_ERROR} Removed from the cart (no longer for sale): Chicken crepe.`,
    );
  });

  it("keeps the cart and the message when the product reload fails", async () => {
    const result = await setupCart();
    createAndConfirmSaleMock.mockResolvedValueOnce({
      data: null,
      error: PRICE_ERROR,
    });
    getRecipesMock.mockResolvedValueOnce({
      data: null,
      error: "Failed to load recipes",
    });

    await act(async () => {
      await result.current.confirm();
    });

    expect(result.current.actionError).toBe(PRICE_ERROR);
    expect(result.current.cartLines[0]?.unit_price).toBe(10);
  });
});
