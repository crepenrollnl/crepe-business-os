/**
 * useDashboard close-shift flow (audit S1 step 4).
 *
 * close_shift (sql/142) writes both daily summaries in the same
 * transaction, so closing only reloads the dashboard — it never generates
 * summaries from the browser.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Shift } from "@/features/shifts/types/shift";

const {
  getDashboardReadModelMock,
  buildFromReadModelMock,
  closeShiftMock,
  generateSalesSummaryMock,
  generateProfitSummaryMock,
} = vi.hoisted(() => ({
  getDashboardReadModelMock: vi.fn(),
  buildFromReadModelMock: vi.fn(),
  closeShiftMock: vi.fn(),
  generateSalesSummaryMock: vi.fn(),
  generateProfitSummaryMock: vi.fn(),
}));

vi.mock("../services/dashboard-service", () => ({
  dashboardService: {
    getDashboardReadModel: (...args: unknown[]) =>
      getDashboardReadModelMock(...args),
  },
}));

vi.mock("../services/dashboard-completion-service", () => ({
  dashboardCompletionService: {
    buildFromReadModel: (...args: unknown[]) => buildFromReadModelMock(...args),
  },
}));

vi.mock("@/features/shifts/services/shift-service", () => ({
  shiftService: {
    openShift: vi.fn(),
    closeShift: (...args: unknown[]) => closeShiftMock(...args),
  },
}));

vi.mock("@/features/shifts/services/cash-reconciliation-service", () => ({
  cashReconciliationService: {
    reconcileShiftCash: vi.fn(),
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

import { useDashboard } from "./use-dashboard";

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

/** Read model with only the shift fields the hook reads when composition is skipped. */
function readModel(current: Shift | null, latestClosed: Shift | null) {
  return {
    current_shift: current,
    latest_closed_shift: latestClosed,
    cash_reconciliation: null,
    low_stock_alerts: [],
    kpi_summary: null,
  };
}

async function renderWithOpenShift() {
  getDashboardReadModelMock.mockResolvedValue({
    data: readModel(openShift(), null),
    error: null,
  });
  const hook = renderHook(() => useDashboard());
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

describe("useDashboard.closeShift", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Skip KPI composition; the hook then applies the shift facts directly.
    buildFromReadModelMock.mockReturnValue({ data: null, error: "skipped" });
  });

  it("closes, reloads the dashboard and never generates summaries", async () => {
    const { result } = await renderWithOpenShift();
    expect(result.current.activeShift).toEqual(openShift());

    closeShiftMock.mockResolvedValue({
      data: {
        shift: closedShift(),
        salesSummary: { id: "s" },
        profitSummary: { id: "p" },
      },
      error: null,
    });
    getDashboardReadModelMock.mockResolvedValue({
      data: readModel(null, closedShift()),
      error: null,
    });

    let closed: boolean | undefined;
    await act(async () => {
      closed = await result.current.closeShift();
    });

    expect(closed).toBe(true);
    expect(closeShiftMock).toHaveBeenCalledWith({ shift_id: SHIFT_ID });
    expect(getDashboardReadModelMock).toHaveBeenCalledTimes(2);
    expect(result.current.activeShift).toBeNull();
    expect(result.current.closedShift).toEqual(closedShift());
    expect(result.current.actionError).toBeNull();
    expect(generateSalesSummaryMock).not.toHaveBeenCalled();
    expect(generateProfitSummaryMock).not.toHaveBeenCalled();
  });

  it("shows the close error without reloading", async () => {
    const { result } = await renderWithOpenShift();
    closeShiftMock.mockResolvedValue({
      data: null,
      error: "Shift was not found.",
    });

    let closed: boolean | undefined;
    await act(async () => {
      closed = await result.current.closeShift();
    });

    expect(closed).toBe(false);
    expect(result.current.actionError).toBe("Shift was not found.");
    expect(getDashboardReadModelMock).toHaveBeenCalledTimes(1);
    expect(generateSalesSummaryMock).not.toHaveBeenCalled();
  });
});
