/**
 * Finished Goods Valuation Service coverage (DEV-104).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { listAvailableBatches, getAvailableBatch, listAvailableBatchesByIds } =
  vi.hoisted(() => ({
    listAvailableBatches: vi.fn(),
    getAvailableBatch: vi.fn(),
    listAvailableBatchesByIds: vi.fn(),
  }));

vi.mock("./finished-goods-read-service", () => ({
  finishedGoodsReadService: {
    listAvailableBatches: (...args: unknown[]) => listAvailableBatches(...args),
    getAvailableBatch: (...args: unknown[]) => getAvailableBatch(...args),
    listAvailableBatchesByIds: (...args: unknown[]) =>
      listAvailableBatchesByIds(...args),
  },
}));

import { finishedGoodsValuationService } from "./finished-goods-valuation-service";

describe("finishedGoodsValuationService (DEV-104)", () => {
  beforeEach(() => {
    listAvailableBatches.mockReset();
    getAvailableBatch.mockReset();
    listAvailableBatchesByIds.mockReset();
  });

  it("returns inventory valuation for a completed batch", async () => {
    getAvailableBatch.mockResolvedValue({
      data: {
        production_batch_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        product_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        batch_number: 7,
        produced_at: "2026-07-26T12:00:00.000Z",
        produced_quantity: 10,
        available_quantity: 6,
        unit_cost: 2,
        total_batch_cost: 20,
        remaining_value: 12,
      },
      error: null,
    });

    const result = await finishedGoodsValuationService.getBatchValuation(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );

    expect(result.error).toBeNull();
    expect(result.data).toEqual({
      production_batch_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      produced_quantity: 10,
      remaining_quantity: 6,
      total_batch_cost: 20,
      unit_cost: 2,
      remaining_value: 12,
    });
  });

  it("rejects duplicate valuations in a product list", async () => {
    listAvailableBatches.mockResolvedValue({
      data: [
        {
          production_batch_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          product_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          batch_number: 1,
          produced_at: "2026-07-26T12:00:00.000Z",
          produced_quantity: 10,
          available_quantity: 10,
          unit_cost: 1,
          total_batch_cost: 10,
          remaining_value: 10,
        },
        {
          production_batch_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          product_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          batch_number: 1,
          produced_at: "2026-07-26T12:00:00.000Z",
          produced_quantity: 10,
          available_quantity: 10,
          unit_cost: 1,
          total_batch_cost: 10,
          remaining_value: 10,
        },
      ],
      error: null,
    });

    const result = await finishedGoodsValuationService.listBatchValuations(
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    );

    expect(result.data).toBeNull();
    expect(result.error).toMatch(/duplicate/i);
  });
});
