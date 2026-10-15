/**
 * Finished goods stock without costs (finished_goods_stock_summary, sql/155).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { supabaseMock } = vi.hoisted(() => ({
  supabaseMock: { from: vi.fn() },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: supabaseMock,
}));

import { finishedGoodsStockService } from "./finished-goods-stock-service";

function mockView(result: { data: unknown; error: unknown }) {
  const chain = {
    select: vi.fn(),
    order: vi.fn(),
  };
  chain.select.mockReturnValue(chain);
  chain.order
    .mockReturnValueOnce(chain)
    .mockResolvedValueOnce(result);
  supabaseMock.from.mockReturnValue(chain);
  return chain;
}

describe("finishedGoodsStockService.listStockSummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads finished_goods_stock_summary without any cost column", async () => {
    const chain = mockView({
      data: [
        {
          product_id: "p-1",
          product_name: "Sauce",
          available_quantity: "10.5",
          active_batch_count: "2",
          oldest_batch_at: "2026-10-01T08:00:00.000Z",
          newest_batch_at: "2026-10-02T08:00:00.000Z",
          production_status: "available",
        },
      ],
      error: null,
    });

    const result = await finishedGoodsStockService.listStockSummary();

    expect(supabaseMock.from).toHaveBeenCalledWith("finished_goods_stock_summary");
    const selected = chain.select.mock.calls[0]?.[0] as string;
    expect(selected).not.toMatch(/cost|value/);
    expect(result.error).toBeNull();
    expect(result.data).toEqual([
      {
        product_id: "p-1",
        product_name: "Sauce",
        available_quantity: 10.5,
        active_batch_count: 2,
        oldest_batch_at: "2026-10-01T08:00:00.000Z",
        newest_batch_at: "2026-10-02T08:00:00.000Z",
        production_status: "available",
      },
    ]);
  });

  it("returns the read error", async () => {
    mockView({ data: null, error: { message: "permission denied" } });

    const result = await finishedGoodsStockService.listStockSummary();

    expect(result.data).toBeNull();
    expect(result.error).toBe("permission denied");
  });

  it("rejects an unknown production status", async () => {
    mockView({
      data: [
        {
          product_id: "p-1",
          product_name: "Sauce",
          available_quantity: 1,
          active_batch_count: 1,
          oldest_batch_at: null,
          newest_batch_at: null,
          production_status: "weird",
        },
      ],
      error: null,
    });

    const result = await finishedGoodsStockService.listStockSummary();

    expect(result.data).toBeNull();
    expect(result.error).toBeTruthy();
  });
});
