import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SaleableNowRow } from "@/features/sales/utils/max-saleable-now";

const { listSaleableNowMock } = vi.hoisted(() => ({
  listSaleableNowMock: vi.fn(),
}));

vi.mock("@/features/sales/services/saleable-now-service", () => ({
  listSaleableNow: (...args: unknown[]) => listSaleableNowMock(...args),
}));

import { useSaleableNow } from "./use-saleable-now";

const ROW: SaleableNowRow = {
  product_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  product_name: "Chicken Crepe",
  max_portions: 3,
  bottleneck_name: "Dough",
  bottleneck_kind: "component",
};

describe("useSaleableNow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listSaleableNowMock.mockResolvedValue({
      data: [ROW],
      error: null,
    });
  });

  it("loads saleable rows", async () => {
    const { result } = renderHook(() => useSaleableNow());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBeNull();
    expect(result.current.rows).toEqual([ROW]);
  });

  it("surfaces a service error", async () => {
    listSaleableNowMock.mockResolvedValue({
      data: null,
      error: "Failed to load finished goods summary",
    });

    const { result } = renderHook(() => useSaleableNow());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.rows).toEqual([]);
    expect(result.current.error).toBe("Failed to load finished goods summary");
  });
});
