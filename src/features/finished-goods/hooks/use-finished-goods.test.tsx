/**
 * useFinishedGoods reads costs only for owner/partner; sellers get the
 * cost-free stock list (sql/155, S4/U5 phase 2a).
 */

import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { listProductAvailabilityMock, listProductStockMock } = vi.hoisted(() => ({
  listProductAvailabilityMock: vi.fn(),
  listProductStockMock: vi.fn(),
}));

vi.mock("../services/finished-goods-list-service", () => ({
  finishedGoodsListService: {
    listProductAvailability: () => listProductAvailabilityMock(),
    listProductStock: () => listProductStockMock(),
  },
}));

import { useFinishedGoods } from "./use-finished-goods";

const ROW = {
  product_id: "p-1",
  product_name: "Sauce",
  available_quantity: 3,
  yield_unit: "kg",
  average_unit_cost: null,
  remaining_value: null,
  newest_batch_at: null,
  production_status: "available" as const,
};

describe("useFinishedGoods data source", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listProductAvailabilityMock.mockResolvedValue({
      data: [{ ...ROW, average_unit_cost: 2, remaining_value: 6 }],
      error: null,
    });
    listProductStockMock.mockResolvedValue({ data: [ROW], error: null });
  });

  it("reads the cost-free stock list for a seller", async () => {
    const { result } = renderHook(() => useFinishedGoods({ showCosts: false }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(listProductStockMock).toHaveBeenCalledTimes(1);
    expect(listProductAvailabilityMock).not.toHaveBeenCalled();
    expect(result.current.items[0]?.average_unit_cost).toBeNull();
  });

  it("keeps the cost read for owner/partner", async () => {
    const { result } = renderHook(() => useFinishedGoods({ showCosts: true }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(listProductAvailabilityMock).toHaveBeenCalledTimes(1);
    expect(listProductStockMock).not.toHaveBeenCalled();
    expect(result.current.items[0]?.average_unit_cost).toBe(2);
  });
});
