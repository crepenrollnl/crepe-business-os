/**
 * POS Sale tiles rank by sold quantity; recipe load still owns the list error.
 *
 * Also covers usePosSale's client_request_id idempotency token (sql/118,
 * audit finding #9): generated once per checkout attempt, reused across a
 * failed retry (so a duplicate request never creates a second sale),
 * invalidated by any cart change before submission, and replaced by a
 * fresh one for the next sale after a successful confirm.
 *
 * Audit D3: a sale committed by the RPC is always treated as success, even
 * when the follow-up reload failed. Audit D4: a "price changed" rejection
 * (sql/146) re-prices the cart from the fresh selling_price.
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
  createAndConfirmSaleAndPostJournalsMock,
  markSaleQueuedMock,
  reportSkippedPostingMock,
} = vi.hoisted(() => ({
  getRecipesMock: vi.fn(),
  getSoldQuantityByProductIdMock: vi.fn(),
  getCurrentAccountingContextMock: vi.fn(),
  createAndConfirmSaleMock: vi.fn(),
  createAndConfirmSaleAndPostJournalsMock: vi.fn(),
  markSaleQueuedMock: vi.fn(),
  reportSkippedPostingMock: vi.fn(),
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
    reportSkippedPosting: (...args: unknown[]) =>
      reportSkippedPostingMock(...args),
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

function confirmedSale(id: string): ConfirmSaleResult {
  return {
    sale_id: id,
    reloadError: null,
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

describe("usePosSale after-commit success + price change (audit D3/D4)", () => {
  const PRICE_ERROR =
    'The price of "Nutella Crepe" is now €7.00. Refresh the screen and try again.';

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
    getCurrentAccountingContextMock.mockResolvedValue({
      data: { fiscalPeriod: { id: "period-1" } },
      error: null,
    });
  });

  async function setupCart() {
    const { result } = renderHook(() => usePosSale());
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => {
      result.current.addToCart(TOKEN_TEST_PRODUCT);
    });
    return result;
  }

  it("treats a committed sale whose reload failed as success and warns", async () => {
    const result = await setupCart();
    createAndConfirmSaleAndPostJournalsMock.mockResolvedValueOnce({
      data: {
        sale_id: "sale-11",
        sale: null,
        total_cogs: 2,
        reloadError: "Statement timeout.",
        posting: null,
        postingError: null,
      },
      error: null,
    });

    let confirmed: boolean | undefined;
    await act(async () => {
      confirmed = await result.current.confirm();
    });

    expect(confirmed).toBe(true);
    expect(result.current.actionError).toBeNull();
    expect(result.current.cartLines).toEqual([]);
    expect(result.current.postingError).toBe(
      "Sale confirmed, but it could not be reloaded: Statement timeout.",
    );
  });

  it("re-prices the cart from the fresh selling_price after a price-changed error", async () => {
    const result = await setupCart();
    createAndConfirmSaleAndPostJournalsMock.mockResolvedValueOnce({
      data: null,
      error: PRICE_ERROR,
    });
    getRecipesMock.mockResolvedValueOnce({
      data: [
        recipe({
          id: TOKEN_TEST_PRODUCT.id,
          name: TOKEN_TEST_PRODUCT.name,
          selling_price: 7,
        }),
      ],
      error: null,
    });

    let confirmed: boolean | undefined;
    await act(async () => {
      confirmed = await result.current.confirm();
    });

    expect(confirmed).toBe(false);
    expect(result.current.actionError).toBe(PRICE_ERROR);
    expect(result.current.cartLines).toEqual([
      {
        product_id: TOKEN_TEST_PRODUCT.id,
        name: TOKEN_TEST_PRODUCT.name,
        unit_price: 7,
        quantity: 1,
      },
    ]);
    expect(result.current.itemsTotal).toBe(7);
    expect(result.current.products[0]?.selling_price).toBe(7);

    // The re-priced cart is a different cart: confirming again sends the
    // new price under a fresh idempotency token.
    const firstToken =
      createAndConfirmSaleAndPostJournalsMock.mock.calls[0][0].client_request_id;
    createAndConfirmSaleAndPostJournalsMock.mockResolvedValueOnce({
      data: {
        ...confirmedSale("sale-12"),
        posting: null,
        postingError: null,
      },
      error: null,
    });
    await act(async () => {
      await result.current.confirm();
    });
    const retry = createAndConfirmSaleAndPostJournalsMock.mock.calls[1][0];
    expect(retry.lines).toEqual([
      { product_id: TOKEN_TEST_PRODUCT.id, quantity: 1, unit_price: 7 },
    ]);
    expect(retry.client_request_id).not.toBe(firstToken);
  });

  it("removes a cart product that is no longer for sale and says so", async () => {
    const result = await setupCart();
    createAndConfirmSaleAndPostJournalsMock.mockResolvedValueOnce({
      data: null,
      error: PRICE_ERROR,
    });
    getRecipesMock.mockResolvedValueOnce({
      data: [
        recipe({
          id: TOKEN_TEST_PRODUCT.id,
          name: TOKEN_TEST_PRODUCT.name,
          selling_price: null,
        }),
      ],
      error: null,
    });

    await act(async () => {
      await result.current.confirm();
    });

    expect(result.current.cartLines).toEqual([]);
    expect(result.current.actionError).toBe(
      `${PRICE_ERROR} Removed from the cart (no longer for sale): Nutella Crepe.`,
    );
  });

  it("shows other confirm errors as before without reloading products", async () => {
    const result = await setupCart();
    createAndConfirmSaleAndPostJournalsMock.mockResolvedValueOnce({
      data: null,
      error: "Not enough finished goods in stock.",
    });
    const recipeCallsBefore = getRecipesMock.mock.calls.length;

    await act(async () => {
      await result.current.confirm();
    });

    expect(result.current.actionError).toBe(
      "Not enough finished goods in stock.",
    );
    expect(getRecipesMock.mock.calls.length).toBe(recipeCallsBefore);
    expect(result.current.cartLines).toHaveLength(1);
  });
});

describe("usePosSale posting-failure recording (audit D1)", () => {
  const ACCOUNTING_CONTEXT = {
    fiscalPeriod: {
      id: "period-1",
      name: "FY2026",
      start_date: "2026-01-01",
      end_date: "2026-12-31",
      status: "open",
      closed_at: null,
      created_at: "2026-01-01T00:00:00.000Z",
    },
    accountRoleBindings: [],
    baseCurrency: "EUR",
    transactionCurrency: "EUR",
    exchangeRate: 1,
    rateDate: "2026-09-14",
  };

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
  });

  async function confirmOneItem() {
    const { result } = renderHook(() => usePosSale());

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.addToCart(TOKEN_TEST_PRODUCT);
    });

    let confirmed: boolean | undefined;
    await act(async () => {
      confirmed = await result.current.confirm();
    });

    return { result, confirmed };
  }

  it("records a pos_confirm posting failure once when the accounting context cannot be loaded", async () => {
    getCurrentAccountingContextMock.mockResolvedValue({
      data: null,
      error: "No open fiscal period covers today's date.",
    });
    createAndConfirmSaleMock.mockResolvedValue({
      data: confirmedSale("sale-9"),
      error: null,
    });

    const { result, confirmed } = await confirmOneItem();

    expect(confirmed).toBe(true);
    expect(result.current.lastConfirmedSaleNumber).toBe("S-000001");
    expect(reportSkippedPostingMock).toHaveBeenCalledTimes(1);
    expect(reportSkippedPostingMock).toHaveBeenCalledWith(
      "sale-9",
      "pos_confirm",
      "No open fiscal period covers today's date.",
    );
    expect(result.current.postingError).toBe(
      "No open fiscal period covers today's date.",
    );
  });

  it("does not record a second failure when the post itself fails (the service already did)", async () => {
    getCurrentAccountingContextMock.mockResolvedValue({
      data: ACCOUNTING_CONTEXT,
      error: null,
    });
    createAndConfirmSaleAndPostJournalsMock.mockResolvedValue({
      data: {
        ...confirmedSale("sale-10"),
        posting: null,
        postingError: "Sale confirmed but accounting posting failed.",
      },
      error: null,
    });

    const { result, confirmed } = await confirmOneItem();

    expect(confirmed).toBe(true);
    expect(createAndConfirmSaleAndPostJournalsMock.mock.calls[0][2]).toBe(
      "pos_confirm",
    );
    expect(reportSkippedPostingMock).not.toHaveBeenCalled();
    expect(result.current.postingError).toBe(
      "Sale confirmed but accounting posting failed.",
    );
  });
});
