/**
 * Hook coverage for useSale's confirm() (DEV-109 wiring).
 *
 * confirmSale has already succeeded and is durable by the time posting is
 * attempted — a posting/context failure must never look like the whole
 * confirm action failed. The sale must still confirm; postingError is the
 * only signal that the accounting entry was skipped or failed.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SaleDetail } from "../types/sale";

const {
  getSaleMock,
  confirmSaleMock,
  confirmSaleAndPostJournalsMock,
  getCurrentAccountingContextMock,
  getSaleCostSummaryMock,
  getSaleProfitSummaryMock,
  buildFrozenSaleProfitMock,
  getSaleCompletedPostingStatusMock,
} = vi.hoisted(() => ({
  getSaleMock: vi.fn(),
  confirmSaleMock: vi.fn(),
  confirmSaleAndPostJournalsMock: vi.fn(),
  getCurrentAccountingContextMock: vi.fn(),
  getSaleCostSummaryMock: vi.fn(),
  getSaleProfitSummaryMock: vi.fn(),
  buildFrozenSaleProfitMock: vi.fn(),
  getSaleCompletedPostingStatusMock: vi.fn(),
}));

vi.mock("../services/sales-read-service", () => ({
  salesReadService: {
    getSale: (...args: unknown[]) => getSaleMock(...args),
  },
}));

vi.mock("../services/sales-service", () => ({
  salesService: {
    confirmSale: (...args: unknown[]) => confirmSaleMock(...args),
    confirmSaleAndPostJournals: (...args: unknown[]) =>
      confirmSaleAndPostJournalsMock(...args),
    addSaleLine: vi.fn(),
    updateSaleLine: vi.fn(),
    deleteSaleLine: vi.fn(),
  },
}));

vi.mock("@/features/accounting/services/accounting-context-service", () => ({
  accountingContextService: {
    getCurrentAccountingContext: (...args: unknown[]) =>
      getCurrentAccountingContextMock(...args),
  },
}));

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
  rateDate: "2026-08-03",
};

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

describe("useSale.confirm (accounting posting wiring)", () => {
  beforeEach(() => {
    getSaleMock.mockReset();
    confirmSaleMock.mockReset();
    confirmSaleAndPostJournalsMock.mockReset();
    getCurrentAccountingContextMock.mockReset();
    getSaleCostSummaryMock.mockReset();
    getSaleProfitSummaryMock.mockReset();
    buildFrozenSaleProfitMock.mockReset();
    getSaleCompletedPostingStatusMock.mockReset();

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
      data: "pending",
      error: null,
    });
  });

  it("confirms and clears postingError when posting succeeds", async () => {
    getCurrentAccountingContextMock.mockResolvedValue({
      data: ACCOUNTING_CONTEXT,
      error: null,
    });
    confirmSaleAndPostJournalsMock.mockResolvedValue({
      data: {
        sale: { id: SALE_ID },
        total_cogs: 4,
        posting: { sale: {}, total_cogs: 4, revenue: {}, cogs: {} },
        postingError: null,
      },
      error: null,
    });
    getSaleMock.mockResolvedValueOnce({ data: draftSale(), error: null });
    getSaleMock.mockResolvedValueOnce({ data: confirmedSale(), error: null });

    const { result } = renderHook(() => useSale(SALE_ID));

    await waitFor(() => expect(result.current.loading).toBe(false));

    let confirmed: boolean | undefined;
    await act(async () => {
      confirmed = await result.current.confirm();
    });

    expect(confirmed).toBe(true);
    expect(confirmSaleAndPostJournalsMock).toHaveBeenCalledTimes(1);
    expect(confirmSaleMock).not.toHaveBeenCalled();
    expect(result.current.sale?.status).toBe("confirmed");
    expect(result.current.lastConfirmCogs).toBe(4);
    expect(result.current.postingError).toBeNull();
    expect(result.current.actionError).toBeNull();
  });

  it("still confirms the sale when posting itself fails, and surfaces postingError", async () => {
    getCurrentAccountingContextMock.mockResolvedValue({
      data: ACCOUNTING_CONTEXT,
      error: null,
    });
    confirmSaleAndPostJournalsMock.mockResolvedValue({
      data: {
        sale: { id: SALE_ID },
        total_cogs: 4,
        posting: null,
        postingError: "Sale confirmed but accounting posting failed.",
      },
      error: null,
    });
    getSaleMock.mockResolvedValueOnce({ data: draftSale(), error: null });
    getSaleMock.mockResolvedValueOnce({ data: confirmedSale(), error: null });

    const { result } = renderHook(() => useSale(SALE_ID));

    await waitFor(() => expect(result.current.loading).toBe(false));

    let confirmed: boolean | undefined;
    await act(async () => {
      confirmed = await result.current.confirm();
    });

    expect(confirmed).toBe(true);
    expect(result.current.sale?.status).toBe("confirmed");
    expect(result.current.postingError).toBe(
      "Sale confirmed but accounting posting failed.",
    );
    expect(result.current.actionError).toBeNull();
  });

  it("falls back to plain confirmSale and still confirms when the accounting context cannot be built", async () => {
    getCurrentAccountingContextMock.mockResolvedValue({
      data: null,
      error: "No open fiscal period covers today's date.",
    });
    confirmSaleMock.mockResolvedValue({
      data: { sale: { id: SALE_ID }, total_cogs: 4 },
      error: null,
    });
    getSaleMock.mockResolvedValueOnce({ data: draftSale(), error: null });
    getSaleMock.mockResolvedValueOnce({ data: confirmedSale(), error: null });

    const { result } = renderHook(() => useSale(SALE_ID));

    await waitFor(() => expect(result.current.loading).toBe(false));

    let confirmed: boolean | undefined;
    await act(async () => {
      confirmed = await result.current.confirm();
    });

    expect(confirmed).toBe(true);
    expect(confirmSaleMock).toHaveBeenCalledTimes(1);
    expect(confirmSaleAndPostJournalsMock).not.toHaveBeenCalled();
    expect(result.current.sale?.status).toBe("confirmed");
    expect(result.current.postingError).toBe(
      "No open fiscal period covers today's date.",
    );
    expect(result.current.actionError).toBeNull();
  });

  it("does not confirm and surfaces actionError when confirmSale itself fails", async () => {
    getCurrentAccountingContextMock.mockResolvedValue({
      data: ACCOUNTING_CONTEXT,
      error: null,
    });
    confirmSaleAndPostJournalsMock.mockResolvedValue({
      data: null,
      error: "Insufficient Finished Goods stock.",
    });
    getSaleMock.mockResolvedValueOnce({ data: draftSale(), error: null });

    const { result } = renderHook(() => useSale(SALE_ID));

    await waitFor(() => expect(result.current.loading).toBe(false));

    let confirmed: boolean | undefined;
    await act(async () => {
      confirmed = await result.current.confirm();
    });

    expect(confirmed).toBe(false);
    expect(result.current.sale?.status).toBe("draft");
    expect(result.current.actionError).toBe("Insufficient Finished Goods stock.");
    expect(result.current.postingError).toBeNull();
  });
});
