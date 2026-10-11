/**
 * Quick Sale tiles rank by sold quantity; recipe load still owns the list error.
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

describe("useQuickSale posting-failure recording (audit D1)", () => {
  const PRODUCT = {
    id: CHICKEN_ID,
    name: "Chicken crepe",
    selling_price: 10,
    image_url: null,
  };

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

  function confirmedSale(id: string): { sale: SaleWithLines; total_cogs: number } {
    return {
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

  async function confirmOneItem() {
    const { result } = renderHook(() => useQuickSale());

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.addToCart(PRODUCT);
    });

    let confirmed: boolean | undefined;
    await act(async () => {
      confirmed = await result.current.confirm();
    });

    return { result, confirmed };
  }

  it("records a quick_sale_confirm posting failure once when the accounting context cannot be loaded", async () => {
    getCurrentAccountingContextMock.mockResolvedValue({
      data: null,
      error: "No open fiscal period covers today's date.",
    });
    createAndConfirmSaleMock.mockResolvedValue({
      data: confirmedSale("sale-42"),
      error: null,
    });

    const { result, confirmed } = await confirmOneItem();

    expect(confirmed).toBe(true);
    expect(result.current.lastConfirmedSaleNumber).toBe("S-000042");
    expect(reportSkippedPostingMock).toHaveBeenCalledTimes(1);
    expect(reportSkippedPostingMock).toHaveBeenCalledWith(
      "sale-42",
      "quick_sale_confirm",
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
        ...confirmedSale("sale-43"),
        posting: null,
        postingError: "Sale confirmed but accounting posting failed.",
      },
      error: null,
    });

    const { result, confirmed } = await confirmOneItem();

    expect(confirmed).toBe(true);
    expect(reportSkippedPostingMock).not.toHaveBeenCalled();
    expect(result.current.postingError).toBe(
      "Sale confirmed but accounting posting failed.",
    );
  });
});
