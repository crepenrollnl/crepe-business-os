/**
 * Hook coverage for useSalesProductReport.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { listForPeriodMock, getActiveShiftMock, getLatestClosedShiftMock } =
  vi.hoisted(() => ({
    listForPeriodMock: vi.fn(),
    getActiveShiftMock: vi.fn(),
    getLatestClosedShiftMock: vi.fn(),
  }));

vi.mock("../services/sales-product-report-service", () => ({
  salesProductReportService: {
    listForPeriod: (...args: unknown[]) => listForPeriodMock(...args),
  },
}));

vi.mock("@/features/shifts/services/shift-service", () => ({
  shiftService: {
    getActiveShift: (...args: unknown[]) => getActiveShiftMock(...args),
    getLatestClosedShift: (...args: unknown[]) =>
      getLatestClosedShiftMock(...args),
  },
}));

import { useSalesProductReport } from "./use-sales-product-report";

const PRODUCT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("useSalesProductReport", () => {
  beforeEach(() => {
    listForPeriodMock.mockReset();
    getActiveShiftMock.mockReset();
    getLatestClosedShiftMock.mockReset();
    listForPeriodMock.mockResolvedValue({
      data: [
        {
          product_id: PRODUCT_A,
          product_name: "Chicken Crepe",
          quantity: 2,
          revenue: 20,
          cogs: 2.01,
          gross_profit: 17.99,
          gross_margin_percent: 89.95,
        },
      ],
      error: null,
    });
    getActiveShiftMock.mockResolvedValue({ data: null, error: null });
    getLatestClosedShiftMock.mockResolvedValue({
      data: {
        id: "c52d5474-6594-4061-91cc-42672111ef19",
        opened_at: "2026-08-29T09:23:00.000Z",
        closed_at: "2026-08-29T13:30:00.000Z",
        status: "closed",
        notes: null,
        created_at: "2026-08-29T09:23:00.000Z",
      },
      error: null,
    });
  });

  it("loads today through listForPeriod", async () => {
    const { result } = renderHook(() => useSalesProductReport());

    await waitFor(() => {
      expect(result.current.rows[0]?.product_name).toBe("Chicken Crepe");
    });

    expect(listForPeriodMock).toHaveBeenCalledTimes(1);
    expect(result.current.preset).toBe("today");
    expect(result.current.error).toBeNull();
    expect(getActiveShiftMock).not.toHaveBeenCalled();
  });

  it("uses the latest closed shift window when this_shift has no open shift", async () => {
    const { result } = renderHook(() => useSalesProductReport());
    await waitFor(() => {
      expect(listForPeriodMock).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      result.current.setPreset("this_shift");
    });

    await waitFor(() => {
      expect(listForPeriodMock).toHaveBeenLastCalledWith({
        from: "2026-08-29T09:23:00.000Z",
        to: "2026-08-29T13:30:00.000Z",
      });
    });
  });
});
