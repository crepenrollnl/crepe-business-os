/**
 * Finished Goods list service — product-level remaining from the report view.
 * Must not recalculate available_quantity / remaining_value in TypeScript.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FinishedGoodsSummaryRow } from "@/features/reports/types/report";

const { reportServiceMock, stockServiceMock, supabaseMock } = vi.hoisted(() => ({
  reportServiceMock: {
    getFinishedGoodsSummary: vi.fn(),
  },
  stockServiceMock: {
    listStockSummary: vi.fn(),
  },
  supabaseMock: {
    from: vi.fn(),
  },
}));

vi.mock("@/features/reports/services/report-service", () => ({
  reportService: reportServiceMock,
}));

vi.mock("@/lib/supabase", () => ({
  supabase: supabaseMock,
}));

vi.mock("./finished-goods-stock-service", () => ({
  finishedGoodsStockService: stockServiceMock,
}));

import { finishedGoodsListService } from "./finished-goods-list-service";

const PRODUCT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const summaryRow: FinishedGoodsSummaryRow = {
  product_id: PRODUCT_ID,
  product_name: "Roasted chicken",
  available_quantity: 7,
  active_batch_count: 1,
  average_unit_cost: 4.5,
  inventory_value: 31.5,
  oldest_batch_at: "2026-08-20T10:00:00.000Z",
  newest_batch_at: "2026-08-22T10:00:00.000Z",
  production_status: "available",
};

function mockRecipes(rows: { id: string; yield_unit: string }[]) {
  const chain = {
    select: vi.fn(),
    in: vi.fn(),
  };
  chain.select.mockReturnValue(chain);
  chain.in.mockResolvedValue({ data: rows, error: null });
  supabaseMock.from.mockReturnValue(chain);
  return chain;
}

describe("finishedGoodsListService.listProductAvailability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an empty list without querying recipes", async () => {
    reportServiceMock.getFinishedGoodsSummary.mockResolvedValue({
      data: [],
      error: null,
    });

    const result = await finishedGoodsListService.listProductAvailability();

    expect(result.error).toBeNull();
    expect(result.data).toEqual([]);
    expect(supabaseMock.from).not.toHaveBeenCalled();
  });

  it("joins yield_unit from recipes without recalculating remaining", async () => {
    reportServiceMock.getFinishedGoodsSummary.mockResolvedValue({
      data: [summaryRow],
      error: null,
    });
    const chain = mockRecipes([{ id: PRODUCT_ID, yield_unit: "kg" }]);

    const result = await finishedGoodsListService.listProductAvailability();

    expect(result.error).toBeNull();
    expect(result.data).toEqual([
      {
        product_id: PRODUCT_ID,
        product_name: "Roasted chicken",
        available_quantity: 7,
        yield_unit: "kg",
        average_unit_cost: 4.5,
        remaining_value: 31.5,
        newest_batch_at: "2026-08-22T10:00:00.000Z",
        production_status: "available",
      },
    ]);
    expect(reportServiceMock.getFinishedGoodsSummary).toHaveBeenCalledTimes(1);
    expect(supabaseMock.from).toHaveBeenCalledWith("recipes");
    expect(chain.select).toHaveBeenCalledWith("id, yield_unit");
    expect(chain.in).toHaveBeenCalledWith("id", [PRODUCT_ID]);
  });

  it("propagates a summary error and does not query recipes", async () => {
    reportServiceMock.getFinishedGoodsSummary.mockResolvedValue({
      data: null,
      error: "Reporting views are not available yet. Apply the reporting foundation database script and try again.",
    });

    const result = await finishedGoodsListService.listProductAvailability();

    expect(result.data).toBeNull();
    expect(result.error).toContain("Reporting views are not available");
    expect(supabaseMock.from).not.toHaveBeenCalled();
  });
});

describe("finishedGoodsListService.listProductStock (sellers, sql/155)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads the cost-free stock summary and never the cost-bearing report view", async () => {
    stockServiceMock.listStockSummary.mockResolvedValue({
      data: [
        {
          product_id: PRODUCT_ID,
          product_name: "Roasted chicken",
          available_quantity: 7,
          active_batch_count: 1,
          oldest_batch_at: "2026-08-20T10:00:00.000Z",
          newest_batch_at: "2026-08-22T10:00:00.000Z",
          production_status: "available",
        },
      ],
      error: null,
    });
    mockRecipes([{ id: PRODUCT_ID, yield_unit: "kg" }]);

    const result = await finishedGoodsListService.listProductStock();

    expect(result.error).toBeNull();
    expect(result.data).toEqual([
      {
        product_id: PRODUCT_ID,
        product_name: "Roasted chicken",
        available_quantity: 7,
        yield_unit: "kg",
        average_unit_cost: null,
        remaining_value: null,
        newest_batch_at: "2026-08-22T10:00:00.000Z",
        production_status: "available",
      },
    ]);
    expect(reportServiceMock.getFinishedGoodsSummary).not.toHaveBeenCalled();
  });

  it("returns the stock error without reading recipes", async () => {
    stockServiceMock.listStockSummary.mockResolvedValue({
      data: null,
      error: "Failed to load finished goods stock",
    });

    const result = await finishedGoodsListService.listProductStock();

    expect(result.error).toBe("Failed to load finished goods stock");
    expect(supabaseMock.from).not.toHaveBeenCalled();
  });
});
