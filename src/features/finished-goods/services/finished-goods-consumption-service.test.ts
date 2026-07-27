/**
 * Finished Goods Batch Consumption service (DEV-107).
 *
 * consumeForSale → allocate_finished_goods_fifo → reload remaining.
 * No COGS reporting. No accounting postings.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AllocateFinishedGoodsResult } from "../types/finished-good";
import type { FinishedGoodsAvailableBatch } from "../types/finished-good";

const {
  allocateFinishedGoodsMock,
  listAvailableBatchesMock,
} = vi.hoisted(() => ({
  allocateFinishedGoodsMock: vi.fn(),
  listAvailableBatchesMock: vi.fn(),
}));

vi.mock("./finished-goods-service", () => ({
  finishedGoodsService: {
    allocateFinishedGoods: allocateFinishedGoodsMock,
  },
}));

vi.mock("./finished-goods-read-service", () => ({
  finishedGoodsReadService: {
    listAvailableBatches: listAvailableBatchesMock,
  },
}));

import { finishedGoodsConsumptionService } from "./finished-goods-consumption-service";

const PRODUCT_ID = "11111111-1111-4111-8111-111111111111";
const SALE_LINE_ID = "22222222-2222-4222-8222-222222222222";
const BATCH_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BATCH_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function available(
  overrides: Partial<FinishedGoodsAvailableBatch> &
    Pick<FinishedGoodsAvailableBatch, "production_batch_id">,
): FinishedGoodsAvailableBatch {
  return {
    product_id: PRODUCT_ID,
    batch_number: 1,
    produced_at: "2026-07-01T08:00:00.000Z",
    produced_quantity: 10,
    available_quantity: 10,
    unit_cost: 2,
    total_batch_cost: 20,
    remaining_value: 20,
    ...overrides,
  };
}

function allocationResult(
  layers: AllocateFinishedGoodsResult["allocation"]["allocations"],
): { data: AllocateFinishedGoodsResult; error: null } {
  const allocated = layers.reduce((sum, layer) => sum + layer.quantity, 0);
  return {
    data: {
      allocation: {
        product_id: PRODUCT_ID,
        requested_quantity: allocated,
        allocated_quantity: allocated,
        total_cost: layers.reduce((sum, layer) => sum + layer.total_cost, 0),
        reason: "sale",
        source_type: "sale_line",
        source_id: SALE_LINE_ID,
        allocations: layers,
      },
      batches: [],
    },
    error: null,
  };
}

describe("finishedGoodsConsumptionService.consumeForSale (DEV-107)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects zero quantity without allocating", async () => {
    const result = await finishedGoodsConsumptionService.consumeForSale({
      product_id: PRODUCT_ID,
      quantity: 0,
      sale_line_id: SALE_LINE_ID,
    });

    expect(result.data).toBeNull();
    expect(result.error).toMatch(/greater than zero/i);
    expect(allocateFinishedGoodsMock).not.toHaveBeenCalled();
  });

  it("rejects negative quantity without allocating", async () => {
    const result = await finishedGoodsConsumptionService.consumeForSale({
      product_id: PRODUCT_ID,
      quantity: -3,
      sale_line_id: SALE_LINE_ID,
    });

    expect(result.data).toBeNull();
    expect(result.error).toMatch(/cannot be negative/i);
    expect(allocateFinishedGoodsMock).not.toHaveBeenCalled();
  });

  it("rejects duplicate consumption via in-memory source keys", async () => {
    const result = await finishedGoodsConsumptionService.consumeForSale(
      {
        product_id: PRODUCT_ID,
        quantity: 2,
        sale_line_id: SALE_LINE_ID,
      },
      {
        alreadyAllocatedSourceKeys: [`sale_line:${SALE_LINE_ID}`],
      },
    );

    expect(result.data).toBeNull();
    expect(result.error).toMatch(/already allocated/i);
    expect(listAvailableBatchesMock).not.toHaveBeenCalled();
    expect(allocateFinishedGoodsMock).not.toHaveBeenCalled();
  });

  it("rejects empty inventory before RPC", async () => {
    listAvailableBatchesMock.mockResolvedValue({
      data: [
        available({
          production_batch_id: BATCH_A,
          available_quantity: 0,
          remaining_value: 0,
        }),
      ],
      error: null,
    });

    const result = await finishedGoodsConsumptionService.consumeForSale({
      product_id: PRODUCT_ID,
      quantity: 1,
      sale_line_id: SALE_LINE_ID,
    });

    expect(result.data).toBeNull();
    expect(result.error).toMatch(/not enough finished goods/i);
    expect(allocateFinishedGoodsMock).not.toHaveBeenCalled();
  });

  it("rejects insufficient inventory before RPC", async () => {
    listAvailableBatchesMock.mockResolvedValue({
      data: [
        available({
          production_batch_id: BATCH_A,
          available_quantity: 2,
          remaining_value: 4,
        }),
      ],
      error: null,
    });

    const result = await finishedGoodsConsumptionService.consumeForSale({
      product_id: PRODUCT_ID,
      quantity: 5,
      sale_line_id: SALE_LINE_ID,
    });

    expect(result.data).toBeNull();
    expect(result.error).toMatch(/not enough finished goods/i);
    expect(allocateFinishedGoodsMock).not.toHaveBeenCalled();
  });

  it("allocates FIFO across multiple batches and returns remaining qty/value", async () => {
    listAvailableBatchesMock
      .mockResolvedValueOnce({
        data: [
          available({
            production_batch_id: BATCH_A,
            produced_at: "2026-07-01T08:00:00.000Z",
            available_quantity: 5,
            unit_cost: 2,
            remaining_value: 10,
          }),
          available({
            production_batch_id: BATCH_B,
            produced_at: "2026-07-02T08:00:00.000Z",
            batch_number: 2,
            produced_quantity: 8,
            available_quantity: 8,
            unit_cost: 3,
            total_batch_cost: 24,
            remaining_value: 24,
          }),
        ],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [
          available({
            production_batch_id: BATCH_A,
            produced_at: "2026-07-01T08:00:00.000Z",
            available_quantity: 0,
            unit_cost: 2,
            remaining_value: 0,
          }),
          available({
            production_batch_id: BATCH_B,
            produced_at: "2026-07-02T08:00:00.000Z",
            batch_number: 2,
            produced_quantity: 8,
            available_quantity: 4,
            unit_cost: 3,
            total_batch_cost: 24,
            remaining_value: 12,
          }),
        ],
        error: null,
      });

    allocateFinishedGoodsMock.mockResolvedValue(
      allocationResult([
        {
          consumption_id: "c1",
          production_batch_id: BATCH_A,
          quantity: 5,
          unit_cost: 2,
          total_cost: 10,
          produced_at: "2026-07-01T08:00:00.000Z",
        },
        {
          consumption_id: "c2",
          production_batch_id: BATCH_B,
          quantity: 4,
          unit_cost: 3,
          total_cost: 12,
          produced_at: "2026-07-02T08:00:00.000Z",
        },
      ]),
    );

    const result = await finishedGoodsConsumptionService.consumeForSale({
      product_id: PRODUCT_ID,
      quantity: 9,
      sale_line_id: SALE_LINE_ID,
      notes: "counter",
    });

    expect(result.error).toBeNull();
    expect(result.data?.allocated_quantity).toBe(9);
    expect(result.data?.layers).toEqual([
      {
        production_batch_id: BATCH_A,
        quantity: 5,
        unit_cost: 2,
        produced_at: "2026-07-01T08:00:00.000Z",
      },
      {
        production_batch_id: BATCH_B,
        quantity: 4,
        unit_cost: 3,
        produced_at: "2026-07-02T08:00:00.000Z",
      },
    ]);
    expect(result.data?.remaining_batches[0]?.available_quantity).toBe(0);
    expect(result.data?.remaining_batches[0]?.remaining_value).toBe(0);
    expect(result.data?.remaining_batches[1]?.available_quantity).toBe(4);
    expect(result.data?.remaining_batches[1]?.remaining_value).toBe(12);
    expect(result.data?.remaining_batches[1]?.unit_cost).toBe(3);

    // Inventory movement only — no COGS/profit field on the result.
    expect(result.data).not.toHaveProperty("total_cogs");
    expect(result.data).not.toHaveProperty("cogs");

    expect(allocateFinishedGoodsMock).toHaveBeenCalledWith({
      product_id: PRODUCT_ID,
      quantity: 9,
      reason: "sale",
      source_type: "sale_line",
      source_id: SALE_LINE_ID,
      notes: "counter",
    });
  });

  it("supports partial single-batch consumption and preserves unit cost", async () => {
    listAvailableBatchesMock
      .mockResolvedValueOnce({
        data: [
          available({
            production_batch_id: BATCH_A,
            available_quantity: 10,
            unit_cost: 2.5,
            remaining_value: 25,
          }),
        ],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [
          available({
            production_batch_id: BATCH_A,
            available_quantity: 7,
            unit_cost: 2.5,
            remaining_value: 17.5,
          }),
        ],
        error: null,
      });

    allocateFinishedGoodsMock.mockResolvedValue(
      allocationResult([
        {
          consumption_id: "c1",
          production_batch_id: BATCH_A,
          quantity: 3,
          unit_cost: 2.5,
          total_cost: 7.5,
          produced_at: "2026-07-01T08:00:00.000Z",
        },
      ]),
    );

    const result = await finishedGoodsConsumptionService.consumeForSale({
      product_id: PRODUCT_ID,
      quantity: 3,
      sale_line_id: SALE_LINE_ID,
    });

    expect(result.error).toBeNull();
    expect(result.data?.layers[0]?.unit_cost).toBe(2.5);
    expect(result.data?.remaining_batches[0]?.available_quantity).toBe(7);
    expect(result.data?.remaining_batches[0]?.remaining_value).toBe(17.5);
    expect(result.data?.remaining_batches[0]?.unit_cost).toBe(2.5);
  });

  it("maps SQL duplicate protection errors from allocateFinishedGoods", async () => {
    listAvailableBatchesMock.mockResolvedValue({
      data: [available({ production_batch_id: BATCH_A })],
      error: null,
    });
    allocateFinishedGoodsMock.mockResolvedValue({
      data: null,
      error: "This item was already allocated.",
    });

    const result = await finishedGoodsConsumptionService.consumeForSale({
      product_id: PRODUCT_ID,
      quantity: 1,
      sale_line_id: SALE_LINE_ID,
    });

    expect(result.data).toBeNull();
    expect(result.error).toMatch(/already allocated/i);
  });
});
