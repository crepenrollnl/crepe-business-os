/**
 * usePosShift close / reconcile flow (audit S1 step 4).
 *
 * close_shift (sql/142) writes both daily summaries in the same
 * transaction, so closing never generates summaries from the browser.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Shift } from "@/features/shifts/types/shift";

const {
  getActiveShiftMock,
  getLatestClosedShiftMock,
  closeShiftMock,
  getReconciliationForShiftMock,
  reconcileShiftCashMock,
  generateSalesSummaryMock,
  generateProfitSummaryMock,
} = vi.hoisted(() => ({
  getActiveShiftMock: vi.fn(),
  getLatestClosedShiftMock: vi.fn(),
  closeShiftMock: vi.fn(),
  getReconciliationForShiftMock: vi.fn(),
  reconcileShiftCashMock: vi.fn(),
  generateSalesSummaryMock: vi.fn(),
  generateProfitSummaryMock: vi.fn(),
}));

vi.mock("@/features/shifts/services/shift-service", () => ({
  shiftService: {
    getActiveShift: (...args: unknown[]) => getActiveShiftMock(...args),
    getLatestClosedShift: (...args: unknown[]) =>
      getLatestClosedShiftMock(...args),
    openShift: vi.fn(),
    closeShift: (...args: unknown[]) => closeShiftMock(...args),
  },
}));

vi.mock("@/features/shifts/services/cash-reconciliation-service", () => ({
  cashReconciliationService: {
    getReconciliationForShift: (...args: unknown[]) =>
      getReconciliationForShiftMock(...args),
    reconcileShiftCash: (...args: unknown[]) =>
      reconcileShiftCashMock(...args),
  },
}));

// Regression guard: the hook must never generate summaries in the browser.
vi.mock("@/features/shifts/services/daily-sales-summary-service", () => ({
  dailySalesSummaryService: {
    generateForClosedShift: (...args: unknown[]) =>
      generateSalesSummaryMock(...args),
  },
}));

vi.mock("@/features/shifts/services/daily-profit-summary-service", () => ({
  dailyProfitSummaryService: {
    generateForClosedShift: (...args: unknown[]) =>
      generateProfitSummaryMock(...args),
  },
}));

import { usePosShift } from "./use-pos-shift";

const SHIFT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function openShift(): Shift {
  return {
    id: SHIFT_ID,
    opened_at: "2026-10-11T08:00:00.000Z",
    closed_at: null,
    status: "open",
    notes: null,
    created_at: "2026-10-11T08:00:00.000Z",
  };
}

function closedShift(): Shift {
  return {
    ...openShift(),
    closed_at: "2026-10-11T18:00:00.000Z",
    status: "closed",
  };
}

async function renderWithOpenShift() {
  getActiveShiftMock.mockResolvedValue({ data: openShift(), error: null });
  const hook = renderHook(() => usePosShift());
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

describe("usePosShift.closeShift", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("closes via shiftService.closeShift, loads the reconciliation and never generates summaries", async () => {
    const { result } = await renderWithOpenShift();
    closeShiftMock.mockResolvedValue({
      data: {
        shift: closedShift(),
        salesSummary: { id: "s" },
        profitSummary: { id: "p" },
      },
      error: null,
    });
    getReconciliationForShiftMock.mockResolvedValue({ data: null, error: null });

    let closed: boolean | undefined;
    await act(async () => {
      closed = await result.current.closeShift();
    });

    expect(closed).toBe(true);
    expect(closeShiftMock).toHaveBeenCalledWith({ shift_id: SHIFT_ID });
    expect(result.current.activeShift).toBeNull();
    expect(result.current.closedShift).toEqual(closedShift());
    expect(getReconciliationForShiftMock).toHaveBeenCalledWith(SHIFT_ID);
    expect(result.current.actionError).toBeNull();
    expect(generateSalesSummaryMock).not.toHaveBeenCalled();
    expect(generateProfitSummaryMock).not.toHaveBeenCalled();
  });

  it("shows the close error and keeps the shift open", async () => {
    const { result } = await renderWithOpenShift();
    closeShiftMock.mockResolvedValue({
      data: null,
      error: "This shift is already closed.",
    });

    let closed: boolean | undefined;
    await act(async () => {
      closed = await result.current.closeShift();
    });

    expect(closed).toBe(false);
    expect(result.current.actionError).toBe("This shift is already closed.");
    expect(result.current.activeShift).toEqual(openShift());
    expect(getReconciliationForShiftMock).not.toHaveBeenCalled();
    expect(generateSalesSummaryMock).not.toHaveBeenCalled();
  });

  it("shows a reconciliation load error after a successful close", async () => {
    const { result } = await renderWithOpenShift();
    closeShiftMock.mockResolvedValue({
      data: {
        shift: closedShift(),
        salesSummary: { id: "s" },
        profitSummary: { id: "p" },
      },
      error: null,
    });
    getReconciliationForShiftMock.mockResolvedValue({
      data: null,
      error: "Failed to load cash reconciliation",
    });

    let closed: boolean | undefined;
    await act(async () => {
      closed = await result.current.closeShift();
    });

    expect(closed).toBe(true);
    expect(result.current.closedShift).toEqual(closedShift());
    expect(result.current.actionError).toBe(
      "Failed to load cash reconciliation",
    );
  });
});

describe("usePosShift.reconcileCash", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function renderWithClosedShift() {
    getActiveShiftMock.mockResolvedValue({ data: null, error: null });
    getLatestClosedShiftMock.mockResolvedValue({
      data: closedShift(),
      error: null,
    });
    getReconciliationForShiftMock.mockResolvedValue({ data: null, error: null });
    const hook = renderHook(() => usePosShift());
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    return hook;
  }

  it("shows the RPC error when reconciliation fails", async () => {
    const { result } = await renderWithClosedShift();
    reconcileShiftCashMock.mockResolvedValue({
      data: null,
      error: "This shift is already reconciled.",
    });

    let reconciled: boolean | undefined;
    await act(async () => {
      reconciled = await result.current.reconcileCash(120);
    });

    expect(reconciled).toBe(false);
    expect(reconcileShiftCashMock).toHaveBeenCalledWith({
      shift_id: SHIFT_ID,
      counted_cash: 120,
    });
    expect(result.current.actionError).toBe(
      "This shift is already reconciled.",
    );
  });
});
