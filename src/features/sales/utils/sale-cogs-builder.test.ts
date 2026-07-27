/**
 * Sales COGS builder coverage (DEV-108).
 */

import { describe, expect, it } from "vitest";
import type { SaleCogsBatchLayer } from "../types/sale-cogs";
import {
  assertSaleCogsImmutable,
  assertUniqueSaleCogsGeneration,
  buildSaleCostSummary,
  validateSaleCogsLayer,
} from "./sale-cogs-builder";

function layer(
  overrides?: Partial<SaleCogsBatchLayer>,
): SaleCogsBatchLayer {
  return {
    consumption_id: "c-1",
    sale_line_id: "line-1",
    production_batch_id: "batch-1",
    batch_number: 12,
    quantity: 5,
    unit_cost: 2,
    total_cost: 10,
    produced_at: "2026-07-01T08:00:00.000Z",
    ...overrides,
  };
}

describe("sale-cogs-builder (DEV-108)", () => {
  it("builds total COGS from a single batch using stored total_cost", () => {
    const result = buildSaleCostSummary({
      sale_id: "sale-1",
      sale_status: "confirmed",
      layers: [layer()],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.summary.total_cogs).toBe(10);
    expect(result.summary.consumed_quantity).toBe(5);
    expect(result.summary.layers).toHaveLength(1);
    expect(result.summary.layers[0]?.unit_cost).toBe(2);
    expect(result.summary.is_frozen).toBe(true);
  });

  it("supports multiple batch FIFO layers", () => {
    const result = buildSaleCostSummary({
      sale_id: "sale-1",
      sale_status: "confirmed",
      layers: [
        layer({
          consumption_id: "c-1",
          production_batch_id: "batch-a",
          batch_number: 1,
          quantity: 5,
          unit_cost: 2,
          total_cost: 10,
        }),
        layer({
          consumption_id: "c-2",
          production_batch_id: "batch-b",
          batch_number: 2,
          quantity: 4,
          unit_cost: 3,
          total_cost: 12,
        }),
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.summary.total_cogs).toBe(22);
    expect(result.summary.consumed_quantity).toBe(9);
    expect(result.summary.layers).toHaveLength(2);
    expect(result.summary.line_summaries[0]?.line_cogs).toBe(22);
  });

  it("supports partial FIFO consumption quantities", () => {
    const result = buildSaleCostSummary({
      sale_id: "sale-1",
      sale_status: "paid",
      layers: [
        layer({
          quantity: 3,
          unit_cost: 1.5,
          total_cost: 4.5,
        }),
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.summary.layers[0]?.quantity).toBe(3);
    expect(result.summary.total_cogs).toBe(4.5);
    // Never recalculate: stored total_cost wins even if qty × unit differs in tests.
    expect(result.summary.layers[0]?.total_cost).toBe(4.5);
  });

  it("rejects empty consumption", () => {
    const result = buildSaleCostSummary({
      sale_id: "sale-1",
      sale_status: "confirmed",
      layers: [],
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toMatch(/no finished goods consumption/i);
  });

  it("rejects zero quantity layers", () => {
    expect(validateSaleCogsLayer(layer({ quantity: 0 }))).toMatch(
      /greater than zero/i,
    );

    const result = buildSaleCostSummary({
      sale_id: "sale-1",
      sale_status: "confirmed",
      layers: [layer({ quantity: 0, total_cost: 0 })],
    });

    expect(result.ok).toBe(false);
  });

  it("rejects duplicate COGS generation for the same sale", () => {
    expect(
      assertUniqueSaleCogsGeneration("sale-1", ["sale-1"]),
    ).toMatch(/already been generated/i);

    const result = buildSaleCostSummary({
      sale_id: "sale-1",
      sale_status: "confirmed",
      layers: [layer()],
      alreadyBuiltSaleIds: ["sale-1"],
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toMatch(/already been generated/i);
  });

  it("rejects COGS build for draft sales", () => {
    const result = buildSaleCostSummary({
      sale_id: "sale-1",
      sale_status: "draft",
      layers: [layer()],
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toMatch(/draft/i);
  });

  it("asserts immutable historical COGS", () => {
    const first = buildSaleCostSummary({
      sale_id: "sale-1",
      sale_status: "confirmed",
      layers: [layer()],
    });
    const second = buildSaleCostSummary({
      sale_id: "sale-1",
      sale_status: "confirmed",
      layers: [layer({ unit_cost: 9, total_cost: 45 })],
    });

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) {
      return;
    }

    expect(
      assertSaleCogsImmutable({
        previous: first.summary,
        next: second.summary,
      }),
    ).toMatch(/immutable/i);

    expect(
      assertSaleCogsImmutable({
        previous: first.summary,
        next: first.summary,
      }),
    ).toBeNull();
  });

  it("never invents unit cost — uses stored layer unit_cost as-is", () => {
    const result = buildSaleCostSummary({
      sale_id: "sale-1",
      sale_status: "confirmed",
      layers: [
        layer({
          quantity: 2,
          unit_cost: 4.1234,
          total_cost: 8.2468,
        }),
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.summary.layers[0]?.unit_cost).toBe(4.1234);
    expect(result.summary.total_cogs).toBe(8.25);
  });
});
