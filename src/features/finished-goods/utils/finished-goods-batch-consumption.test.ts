/**
 * Finished Goods Batch Consumption — pure FIFO + remaining projection (DEV-107).
 */

import { describe, expect, it } from "vitest";
import type { FifoBatchCandidate } from "./finished-goods-batch-consumption";
import {
  assertUniqueConsumptionSource,
  consumptionLayerInventoryCost,
  consumptionSourceKey,
  planFifoBatchConsumption,
  projectRemainingAfterConsumption,
  validateConsumptionQuantity,
} from "./finished-goods-batch-consumption";

function batch(
  overrides: Partial<FifoBatchCandidate> &
    Pick<FifoBatchCandidate, "production_batch_id">,
): FifoBatchCandidate {
  return {
    produced_quantity: 10,
    available_quantity: 10,
    unit_cost: 2,
    produced_at: "2026-07-01T08:00:00.000Z",
    ...overrides,
  };
}

describe("finished-goods-batch-consumption (DEV-107)", () => {
  describe("validateConsumptionQuantity", () => {
    it("rejects zero quantity", () => {
      expect(validateConsumptionQuantity(0)).toMatch(/greater than zero/i);
    });

    it("rejects negative quantity", () => {
      expect(validateConsumptionQuantity(-1)).toMatch(/cannot be negative/i);
    });

    it("accepts positive quantity", () => {
      expect(validateConsumptionQuantity(3)).toBeNull();
    });
  });

  describe("duplicate consumption protection", () => {
    it("builds a stable source key", () => {
      expect(consumptionSourceKey("sale_line", "line-1")).toBe(
        "sale_line:line-1",
      );
    });

    it("rejects duplicate source allocation", () => {
      expect(
        assertUniqueConsumptionSource("sale_line", "line-1", [
          "sale_line:line-1",
        ]),
      ).toMatch(/already allocated/i);
    });

    it("allows a new source", () => {
      expect(
        assertUniqueConsumptionSource("sale_line", "line-2", [
          "sale_line:line-1",
        ]),
      ).toBeNull();
    });
  });

  describe("planFifoBatchConsumption", () => {
    it("selects the oldest batch first (FIFO)", () => {
      const plan = planFifoBatchConsumption(
        [
          batch({
            production_batch_id: "batch-new",
            produced_at: "2026-07-10T08:00:00.000Z",
            unit_cost: 3,
          }),
          batch({
            production_batch_id: "batch-old",
            produced_at: "2026-07-01T08:00:00.000Z",
            unit_cost: 2,
          }),
        ],
        4,
      );

      expect(plan.ok).toBe(true);
      if (!plan.ok) {
        return;
      }

      expect(plan.plan.layers).toEqual([
        {
          production_batch_id: "batch-old",
          quantity: 4,
          unit_cost: 2,
          produced_at: "2026-07-01T08:00:00.000Z",
        },
      ]);
      expect(plan.plan.remaining_after[0]?.production_batch_id).toBe(
        "batch-old",
      );
      expect(plan.plan.remaining_after[0]?.remaining_quantity).toBe(6);
      expect(plan.plan.remaining_after[0]?.remaining_value).toBe(12);
      expect(plan.plan.remaining_after[0]?.unit_cost).toBe(2);
    });

    it("supports partial batch consumption", () => {
      const plan = planFifoBatchConsumption(
        [
          batch({
            production_batch_id: "batch-a",
            produced_quantity: 10,
            available_quantity: 10,
            unit_cost: 1.5,
          }),
        ],
        3,
      );

      expect(plan.ok).toBe(true);
      if (!plan.ok) {
        return;
      }

      expect(plan.plan.layers[0]?.quantity).toBe(3);
      expect(plan.plan.remaining_after[0]?.remaining_quantity).toBe(7);
      expect(plan.plan.remaining_after[0]?.remaining_value).toBe(10.5);
      expect(plan.plan.remaining_after[0]?.unit_cost).toBe(1.5);
    });

    it("supports multiple batch consumption", () => {
      const plan = planFifoBatchConsumption(
        [
          batch({
            production_batch_id: "batch-a",
            produced_at: "2026-07-01T08:00:00.000Z",
            produced_quantity: 5,
            available_quantity: 5,
            unit_cost: 2,
          }),
          batch({
            production_batch_id: "batch-b",
            produced_at: "2026-07-02T08:00:00.000Z",
            produced_quantity: 8,
            available_quantity: 8,
            unit_cost: 3,
          }),
        ],
        9,
      );

      expect(plan.ok).toBe(true);
      if (!plan.ok) {
        return;
      }

      expect(plan.plan.layers).toEqual([
        {
          production_batch_id: "batch-a",
          quantity: 5,
          unit_cost: 2,
          produced_at: "2026-07-01T08:00:00.000Z",
        },
        {
          production_batch_id: "batch-b",
          quantity: 4,
          unit_cost: 3,
          produced_at: "2026-07-02T08:00:00.000Z",
        },
      ]);
      expect(plan.plan.remaining_after).toEqual([
        {
          production_batch_id: "batch-a",
          produced_quantity: 5,
          remaining_quantity: 0,
          unit_cost: 2,
          remaining_value: 0,
        },
        {
          production_batch_id: "batch-b",
          produced_quantity: 8,
          remaining_quantity: 4,
          unit_cost: 3,
          remaining_value: 12,
        },
      ]);
    });

    it("rejects empty inventory", () => {
      expect(planFifoBatchConsumption([], 1).ok).toBe(false);
      expect(
        planFifoBatchConsumption(
          [
            batch({
              production_batch_id: "batch-a",
              available_quantity: 0,
            }),
          ],
          1,
        ),
      ).toMatchObject({
        ok: false,
        error: expect.stringMatching(/not enough finished goods/i),
      });
    });

    it("rejects insufficient inventory", () => {
      const plan = planFifoBatchConsumption(
        [
          batch({
            production_batch_id: "batch-a",
            available_quantity: 2,
          }),
        ],
        5,
      );

      expect(plan).toMatchObject({
        ok: false,
        error: expect.stringMatching(/not enough finished goods/i),
      });
    });

    it("rejects zero and negative quantity", () => {
      const batches = [
        batch({ production_batch_id: "batch-a", available_quantity: 5 }),
      ];
      expect(planFifoBatchConsumption(batches, 0).ok).toBe(false);
      expect(planFifoBatchConsumption(batches, -2)).toMatchObject({
        ok: false,
        error: expect.stringMatching(/cannot be negative/i),
      });
    });

    it("preserves immutable unit cost on remaining projection", () => {
      const plan = planFifoBatchConsumption(
        [
          batch({
            production_batch_id: "batch-a",
            available_quantity: 10,
            unit_cost: 4.25,
          }),
        ],
        2,
      );

      expect(plan.ok).toBe(true);
      if (!plan.ok) {
        return;
      }

      expect(plan.plan.layers[0]?.unit_cost).toBe(4.25);
      expect(plan.plan.remaining_after[0]?.unit_cost).toBe(4.25);
      expect(plan.plan.remaining_after[0]?.remaining_value).toBe(34);
    });
  });

  describe("projectRemainingAfterConsumption", () => {
    it("reduces remaining quantity and remaining value", () => {
      const projected = projectRemainingAfterConsumption(
        [
          batch({
            production_batch_id: "batch-a",
            available_quantity: 10,
            unit_cost: 2,
          }),
        ],
        [
          {
            production_batch_id: "batch-a",
            quantity: 4,
            unit_cost: 2,
            produced_at: "2026-07-01T08:00:00.000Z",
          },
        ],
      );

      expect(projected.ok).toBe(true);
      if (!projected.ok) {
        return;
      }

      expect(projected.remaining[0]?.remaining_quantity).toBe(6);
      expect(projected.remaining[0]?.remaining_value).toBe(12);
    });

    it("rejects unit cost mutation", () => {
      const projected = projectRemainingAfterConsumption(
        [
          batch({
            production_batch_id: "batch-a",
            unit_cost: 2,
          }),
        ],
        [
          {
            production_batch_id: "batch-a",
            quantity: 1,
            unit_cost: 9,
            produced_at: "2026-07-01T08:00:00.000Z",
          },
        ],
      );

      expect(projected.ok).toBe(false);
      if (projected.ok) {
        return;
      }
      expect(projected.error).toMatch(/immutable/i);
    });
  });

  it("computes layer inventory cost without treating it as sale COGS reporting", () => {
    expect(
      consumptionLayerInventoryCost({ quantity: 3, unit_cost: 2.5 }),
    ).toBe(7.5);
  });
});
