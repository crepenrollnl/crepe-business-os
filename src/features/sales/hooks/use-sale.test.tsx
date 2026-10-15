/**
 * Hook coverage for useSale's confirm() and accounting-status visibility.
 *
 * Audit D2/K3 (sql/147): confirm is confirm_sale only -- the database posts
 * the journals at COMMIT, so the hook never loads an accounting context or
 * posts. Audit D3: once confirm_sale committed, a failed reload is a
 * non-blocking warning, never a failed confirm. The journal status is read
 * and shown for owner/partner only; a seller never sees accounting state.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SaleDetail } from "../types/sale";

const {
  getSaleMock,
  confirmSaleMock,
  getCurrentAccountingContextMock,
  getSaleCostSummaryMock,
  getSaleProfitSummaryMock,
  buildFrozenSaleProfitMock,
  getSaleCompletedPostingStatusMock,
  useRoleMock,
} = vi.hoisted(() => ({
  getSaleMock: vi.fn(),
  confirmSaleMock: vi.fn(),
  getCurrentAccountingContextMock: vi.fn(),
  getSaleCostSummaryMock: vi.fn(),
  getSaleProfitSummaryMock: vi.fn(),
  buildFrozenSaleProfitMock: vi.fn(),
  getSaleCompletedPostingStatusMock: vi.fn(),
  useRoleMock: vi.fn(),
}));

vi.mock("../services/sales-read-service", () => ({
  salesReadService: {
    getSale: (...args: unknown[]) => getSaleMock(...args),
  },
}));

vi.mock("../services/sales-service", () => ({
  salesService: {
    confirmSale: (...args: unknown[]) => confirmSaleMock(...args),
    addSaleLine: vi.fn(),
    updateSaleLine: vi.fn(),
    deleteSaleLine: vi.fn(),
  },
}));

// Kept only to prove confirm never loads an accounting context (sql/147).
vi.mock("@/features/accounting/services/accounting-context-service", () => ({
  accountingContextService: {
    getCurrentAccountingContext: (...args: unknown[]) =>
      getCurrentAccountingContextMock(...args),
  },
}));

vi.mock("@/hooks/use-role", () => ({
  useRole: () => useRoleMock(),
}));

function asRole(role: string | null) {
  useRoleMock.mockReturnValue({ role, loading: false, reload: () => undefined });
}

vi.mock("../services/sale-cogs-service", () => ({
  saleCogsService: {
    getSaleCostSummary: (...args: unknown[]) => getSaleCostSummaryMock(...args),
  },
}));

vi.mock("../services/sale-profit-service", () => ({
  saleProfitService: {
    getSaleProfitSummary: (...args: unknown[]) =>
      getSaleProfitSummaryMock(...args),
    buildFrozenSaleProfit: (...args: unknown[]) =>
      buildFrozenSaleProfitMock(...args),
  },
}));

vi.mock("../services/sale-accounting-service", () => ({
  saleAccountingService: {
    getSaleCompletedPostingStatus: (...args: unknown[]) =>
      getSaleCompletedPostingStatusMock(...args),
  },
}));

import { useSale } from "./use-sale";

const SALE_ID = "sale-1";

function draftSale(): SaleDetail {
  return {
    sale_id: SALE_ID,
    sale_number: "S-0001",
    status: "draft",
    sale_date: "2026-08-03",
    customer_id: null,
    subtotal: 10,
    tax_total: 0,
    total: 10,
    confirmed_at: null,
    paid_at: null,
    cancelled_at: null,
    discount_type: null,
    discount_value: null,
    discount_amount: null,
    lines: [
      {
        line_id: "line-1",
        product_id: "product-1",
        quantity: 1,
        unit_price: 10,
        line_total: 10,
      },
    ],
  };
}

function confirmedSale(): SaleDetail {
  return {
    ...draftSale(),
    status: "confirmed",
    confirmed_at: "2026-08-03T09:00:00.000Z",
  };
}

function confirmResult(reloadError: string | null = null) {
  return {
    data: {
      sale_id: SALE_ID,
      sale: reloadError ? null : { id: SALE_ID },
      total_cogs: 4,
      reloadError,
    },
    error: null,
  };
}

async function renderAndConfirm() {
  const { result } = renderHook(() => useSale(SALE_ID));

  await waitFor(() => expect(result.current.loading).toBe(false));

  let confirmed: boolean | undefined;
  await act(async () => {
    confirmed = await result.current.confirm();
  });

  return { result, confirmed };
}

describe("useSale.confirm (audit D2/K3: database posts the journals)", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    getSaleMock.mockResolvedValue({ data: draftSale(), error: null });
    getSaleCostSummaryMock.mockResolvedValue({
      data: { total_cogs: 4 },
      error: null,
    });
    buildFrozenSaleProfitMock.mockResolvedValue({
      data: { gross_profit: 6 },
      error: null,
    });
    getSaleCompletedPostingStatusMock.mockResolvedValue({
      data: "posted",
      error: null,
    });
    asRole("owner");
  });

  it("confirms through confirm_sale only and never loads an accounting context", async () => {
    confirmSaleMock.mockResolvedValue(confirmResult());
    getSaleMock.mockResolvedValueOnce({ data: draftSale(), error: null });
    getSaleMock.mockResolvedValueOnce({ data: confirmedSale(), error: null });

    const { result, confirmed } = await renderAndConfirm();

    expect(confirmed).toBe(true);
    expect(confirmSaleMock).toHaveBeenCalledTimes(1);
    expect(confirmSaleMock).toHaveBeenCalledWith(SALE_ID);
    expect(getCurrentAccountingContextMock).not.toHaveBeenCalled();
    expect(result.current.sale?.status).toBe("confirmed");
    expect(result.current.lastConfirmCogs).toBe(4);
    expect(result.current.warning).toBeNull();
    expect(result.current.actionError).toBeNull();
  });

  it("does not confirm and surfaces actionError when confirmSale itself fails", async () => {
    confirmSaleMock.mockResolvedValue({
      data: null,
      error: "Insufficient Finished Goods stock.",
    });

    const { result, confirmed } = await renderAndConfirm();

    expect(confirmed).toBe(false);
    expect(result.current.sale?.status).toBe("draft");
    expect(result.current.actionError).toBe(
      "Insufficient Finished Goods stock.",
    );
    expect(result.current.warning).toBeNull();
  });

  it("shows the page as confirmed when the service could not reload the committed sale (audit D3)", async () => {
    confirmSaleMock.mockResolvedValue(confirmResult("Statement timeout."));
    getSaleMock.mockResolvedValueOnce({ data: draftSale(), error: null });
    getSaleMock.mockResolvedValueOnce({ data: confirmedSale(), error: null });

    const { result, confirmed } = await renderAndConfirm();

    expect(confirmed).toBe(true);
    expect(result.current.actionError).toBeNull();
    expect(result.current.sale?.status).toBe("confirmed");
    expect(result.current.warning).toBe(
      "Sale confirmed, but it could not be reloaded: Statement timeout.",
    );
  });

  it("keeps the confirmation and warns when the page reload after confirm fails (audit D3)", async () => {
    confirmSaleMock.mockResolvedValue(confirmResult());
    getSaleMock.mockResolvedValueOnce({ data: draftSale(), error: null });
    getSaleMock.mockResolvedValueOnce({
      data: null,
      error: "Failed to load sale",
    });

    const { result, confirmed } = await renderAndConfirm();

    expect(confirmed).toBe(true);
    expect(result.current.actionError).toBeNull();
    expect(result.current.sale?.status).toBe("confirmed");
    expect(result.current.warning).toBe(
      "Sale confirmed, but it could not be reloaded: Failed to load sale",
    );
  });
});

describe("useSale accounting status visibility (audit D2/K3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    getSaleMock.mockResolvedValue({ data: confirmedSale(), error: null });
    getSaleCostSummaryMock.mockResolvedValue({
      data: { total_cogs: 4 },
      error: null,
    });
    getSaleProfitSummaryMock.mockResolvedValue({
      data: { gross_profit: 6 },
      error: null,
    });
    getSaleCompletedPostingStatusMock.mockResolvedValue({
      data: "posted",
      error: null,
    });
  });

  it.each(["owner", "partner"])(
    "reads and shows the journal status for %s",
    async (role) => {
      asRole(role);

      const { result } = renderHook(() => useSale(SALE_ID));

      await waitFor(() =>
        expect(result.current.accountingPostingStatus).toBe("posted"),
      );
      expect(result.current.showAccountingStatus).toBe(true);
      expect(getSaleCompletedPostingStatusMock).toHaveBeenCalledWith(SALE_ID);
    },
  );

  it("never reads or shows the journal status for a seller", async () => {
    asRole("seller");

    const { result } = renderHook(() => useSale(SALE_ID));

    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(result.current.reviewLoading).toBe(false));

    expect(result.current.showAccountingStatus).toBe(false);
    expect(result.current.accountingPostingStatus).toBe("pending");
    expect(getSaleCompletedPostingStatusMock).not.toHaveBeenCalled();
  });

  it("never requests COGS or profit (verify_sale_cost_and_profit) for a seller (S4/U5)", async () => {
    asRole("seller");

    const { result } = renderHook(() => useSale(SALE_ID));

    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(result.current.reviewLoading).toBe(false));

    expect(result.current.showCosts).toBe(false);
    expect(result.current.cogsSummary).toBeNull();
    expect(result.current.profitSummary).toBeNull();
    expect(getSaleCostSummaryMock).not.toHaveBeenCalled();
    expect(getSaleProfitSummaryMock).not.toHaveBeenCalled();
    expect(buildFrozenSaleProfitMock).not.toHaveBeenCalled();
  });

  it.each(["owner", "partner"])("loads COGS and profit for %s", async (role) => {
    asRole(role);

    const { result } = renderHook(() => useSale(SALE_ID));

    await waitFor(() => expect(result.current.reviewLoading).toBe(false));
    await waitFor(() =>
      expect(getSaleCostSummaryMock).toHaveBeenCalledWith(SALE_ID),
    );
    expect(result.current.showCosts).toBe(true);
    expect(getSaleProfitSummaryMock).toHaveBeenCalledWith(SALE_ID);
  });

  it("treats an unknown role (get_my_role failed) like a seller", async () => {
    asRole(null);

    const { result } = renderHook(() => useSale(SALE_ID));

    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(result.current.reviewLoading).toBe(false));

    expect(result.current.showAccountingStatus).toBe(false);
    expect(getSaleCompletedPostingStatusMock).not.toHaveBeenCalled();
  });
});
