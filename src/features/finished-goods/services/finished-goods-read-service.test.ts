/**
 * Finished Goods read service coverage (DEV-024 / DEV-104 / V1 plan 1.8).
 *
 * Read-only: finished_goods_batch_availability view (+ legacy fallback
 * before sql/059) and finished_goods_batch_consumptions sale-line rows.
 * This file did not exist before V1 plan 1.8 — the service had zero tests
 * despite being the read model sale-cogs-service.ts depends on for COGS.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { supabaseMock } = vi.hoisted(() => ({
  supabaseMock: { from: vi.fn() },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: supabaseMock,
}));

import { finishedGoodsReadService } from "./finished-goods-read-service";

const PRODUCT_ID = "11111111-1111-4111-8111-111111111111";
const BATCH_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BATCH_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LINE_A = "22222222-2222-4222-8222-222222222222";
const LINE_B = "33333333-3333-4333-8333-333333333333";

/**
 * Minimal thenable query-builder stub matching supabase-js's chainable
 * PostgrestFilterBuilder shape: select/eq/in/order all return the same
 * builder, and the builder itself resolves like a Promise when awaited.
 */
function makeBuilder(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.select = vi.fn(chain);
  builder.eq = vi.fn(chain);
  builder.in = vi.fn(chain);
  builder.order = vi.fn(chain);
  builder.then = (
    resolve: (value: { data: unknown; error: unknown }) => unknown,
    reject?: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(resolve, reject);
  return builder;
}

function availabilityRow(overrides?: Record<string, unknown>) {
  return {
    production_batch_id: BATCH_A,
    product_id: PRODUCT_ID,
    batch_number: 1,
    produced_at: "2026-07-01T08:00:00.000Z",
    produced_quantity: 10,
    available_quantity: 4,
    unit_cost: 2.5,
    // Deliberately not equal to quantity × unit_cost, so tests can prove
    // these stored values are passed through as-is rather than recomputed.
    total_batch_cost: 25.5,
    remaining_value: 11.5,
    ...overrides,
  };
}

const MISSING_COLUMN_ERROR = {
  message:
    'column finished_goods_batch_availability.total_batch_cost does not exist',
  code: "42703",
};

describe("finishedGoodsReadService (DEV-024 / DEV-104)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("listAvailableBatches", () => {
    it("lists all batches ordered by produced_at, passing through stored valuation", async () => {
      const builder = makeBuilder({ data: [availabilityRow()], error: null });
      supabaseMock.from.mockReturnValue(builder);

      const result = await finishedGoodsReadService.listAvailableBatches();

      expect(result.error).toBeNull();
      expect(result.data).toHaveLength(1);
      expect(result.data?.[0]).toMatchObject({
        production_batch_id: BATCH_A,
        unit_cost: 2.5,
        total_batch_cost: 25.5,
        remaining_value: 11.5,
      });
      expect(supabaseMock.from).toHaveBeenCalledWith(
        "finished_goods_batch_availability",
      );
      expect(builder.order).toHaveBeenCalledWith("produced_at", {
        ascending: true,
      });
    });

    it("rounds unit_cost to 4 decimal places", async () => {
      supabaseMock.from.mockReturnValue(
        makeBuilder({
          data: [availabilityRow({ unit_cost: 2.123449 })],
          error: null,
        }),
      );

      const result = await finishedGoodsReadService.listAvailableBatches();

      expect(result.data?.[0]?.unit_cost).toBe(2.1234);
    });

    it("filters by product id when provided", async () => {
      const builder = makeBuilder({ data: [availabilityRow()], error: null });
      supabaseMock.from.mockReturnValue(builder);

      await finishedGoodsReadService.listAvailableBatches(PRODUCT_ID);

      expect(builder.eq).toHaveBeenCalledWith("product_id", PRODUCT_ID);
    });

    it("rejects a malformed product id without querying the database", async () => {
      const result =
        await finishedGoodsReadService.listAvailableBatches("not-a-uuid");

      expect(result.data).toBeNull();
      expect(result.error).toMatch(/product id is required/i);
      expect(supabaseMock.from).not.toHaveBeenCalled();
    });

    it("falls back to the legacy select before sql/059 valuation columns", async () => {
      const legacyRow = availabilityRow();
      delete (legacyRow as Record<string, unknown>).total_batch_cost;
      delete (legacyRow as Record<string, unknown>).remaining_value;

      const primaryBuilder = makeBuilder({
        data: null,
        error: MISSING_COLUMN_ERROR,
      });
      const legacyBuilder = makeBuilder({ data: [legacyRow], error: null });
      supabaseMock.from
        .mockReturnValueOnce(primaryBuilder)
        .mockReturnValueOnce(legacyBuilder);

      const result = await finishedGoodsReadService.listAvailableBatches();

      expect(result.error).toBeNull();
      // No stored valuation columns in the legacy row — computed instead:
      // total_batch_cost = produced_quantity × unit_cost, remaining_value =
      // available_quantity × unit_cost.
      expect(result.data?.[0]?.total_batch_cost).toBe(25);
      expect(result.data?.[0]?.remaining_value).toBe(10);
      expect(supabaseMock.from).toHaveBeenCalledTimes(2);
    });

    it("does not fall back on an unrelated database error", async () => {
      supabaseMock.from.mockReturnValue(
        makeBuilder({ data: null, error: { message: "connection refused" } }),
      );

      const result = await finishedGoodsReadService.listAvailableBatches();

      expect(result.data).toBeNull();
      expect(result.error).toBe("connection refused");
      expect(supabaseMock.from).toHaveBeenCalledTimes(1);
    });

    it("maps a missing view into a user-safe setup message", async () => {
      supabaseMock.from.mockReturnValue(
        makeBuilder({
          data: null,
          error: {
            message:
              'relation "finished_goods_batch_availability" does not exist',
            code: "42P01",
          },
        }),
      );

      const result = await finishedGoodsReadService.listAvailableBatches();

      expect(result.data).toBeNull();
      expect(result.error).toMatch(/apply the finished-goods availability/i);
    });
  });

  describe("listAvailableBatchesByIds", () => {
    it("returns an empty list without querying when given no ids", async () => {
      const result = await finishedGoodsReadService.listAvailableBatchesByIds(
        [],
      );

      expect(result.error).toBeNull();
      expect(result.data).toEqual([]);
      expect(supabaseMock.from).not.toHaveBeenCalled();
    });

    it("rejects an invalid batch id", async () => {
      const result = await finishedGoodsReadService.listAvailableBatchesByIds(
        ["not-a-uuid"],
      );

      expect(result.data).toBeNull();
      expect(result.error).toMatch(/one or more batch ids are invalid/i);
      expect(supabaseMock.from).not.toHaveBeenCalled();
    });

    it("dedupes ids before querying", async () => {
      const builder = makeBuilder({ data: [availabilityRow()], error: null });
      supabaseMock.from.mockReturnValue(builder);

      await finishedGoodsReadService.listAvailableBatchesByIds([
        BATCH_A,
        BATCH_A,
      ]);

      expect(builder.in).toHaveBeenCalledWith("production_batch_id", [
        BATCH_A,
      ]);
    });

    it("lists batches for the given ids", async () => {
      supabaseMock.from.mockReturnValue(
        makeBuilder({
          data: [
            availabilityRow({ production_batch_id: BATCH_A }),
            availabilityRow({ production_batch_id: BATCH_B }),
          ],
          error: null,
        }),
      );

      const result = await finishedGoodsReadService.listAvailableBatchesByIds(
        [BATCH_A, BATCH_B],
      );

      expect(result.error).toBeNull();
      expect(result.data).toHaveLength(2);
    });

    it("falls back to the legacy select on missing valuation columns", async () => {
      const legacyRow = availabilityRow();
      delete (legacyRow as Record<string, unknown>).total_batch_cost;
      delete (legacyRow as Record<string, unknown>).remaining_value;

      supabaseMock.from
        .mockReturnValueOnce(
          makeBuilder({ data: null, error: MISSING_COLUMN_ERROR }),
        )
        .mockReturnValueOnce(makeBuilder({ data: [legacyRow], error: null }));

      const result = await finishedGoodsReadService.listAvailableBatchesByIds(
        [BATCH_A],
      );

      expect(result.error).toBeNull();
      expect(result.data?.[0]?.total_batch_cost).toBe(25);
      expect(supabaseMock.from).toHaveBeenCalledTimes(2);
    });
  });

  describe("getAvailableBatch", () => {
    it("returns the single matching batch", async () => {
      supabaseMock.from.mockReturnValue(
        makeBuilder({ data: [availabilityRow()], error: null }),
      );

      const result = await finishedGoodsReadService.getAvailableBatch(
        BATCH_A,
      );

      expect(result.error).toBeNull();
      expect(result.data?.production_batch_id).toBe(BATCH_A);
    });

    it("fails when no row matches the batch id", async () => {
      supabaseMock.from.mockReturnValue(
        makeBuilder({ data: [], error: null }),
      );

      const result = await finishedGoodsReadService.getAvailableBatch(
        BATCH_A,
      );

      expect(result.data).toBeNull();
      expect(result.error).toMatch(/was not found/i);
    });

    it("rejects a malformed batch id without querying the database", async () => {
      const result =
        await finishedGoodsReadService.getAvailableBatch("not-a-uuid");

      expect(result.data).toBeNull();
      expect(result.error).toMatch(/batch id is required/i);
      expect(supabaseMock.from).not.toHaveBeenCalled();
    });
  });

  describe("listConsumptionsForSaleLines", () => {
    function consumptionRow(overrides?: Record<string, unknown>) {
      return {
        id: "c-1",
        production_batch_id: BATCH_A,
        quantity: 5,
        unit_cost: 2.123449,
        total_cost: 10.62,
        source_id: LINE_A,
        created_at: "2026-07-26T12:00:00.000Z",
        production_batches: { batch_number: 1, produced_at: "2026-07-01T08:00:00.000Z" },
        ...overrides,
      };
    }

    it("returns an empty list without querying when given no ids", async () => {
      const result =
        await finishedGoodsReadService.listConsumptionsForSaleLines([]);

      expect(result.error).toBeNull();
      expect(result.data).toEqual([]);
      expect(supabaseMock.from).not.toHaveBeenCalled();
    });

    it("rejects an invalid sale line id", async () => {
      const result =
        await finishedGoodsReadService.listConsumptionsForSaleLines([
          "not-a-uuid",
        ]);

      expect(result.data).toBeNull();
      expect(result.error).toMatch(/one or more sale line ids are invalid/i);
    });

    it("maps a joined production_batches object", async () => {
      const builder = makeBuilder({
        data: [consumptionRow()],
        error: null,
      });
      supabaseMock.from.mockReturnValue(builder);

      const result =
        await finishedGoodsReadService.listConsumptionsForSaleLines([
          LINE_A,
        ]);

      expect(result.error).toBeNull();
      expect(result.data?.[0]).toMatchObject({
        consumption_id: "c-1",
        sale_line_id: LINE_A,
        production_batch_id: BATCH_A,
        batch_number: 1,
        quantity: 5,
        unit_cost: 2.1234,
        total_cost: 10.62,
        produced_at: "2026-07-01T08:00:00.000Z",
      });
      expect(builder.eq).toHaveBeenCalledWith("source_type", "sale_line");
      expect(builder.eq).toHaveBeenCalledWith("direction", "out");
      expect(builder.eq).toHaveBeenCalledWith("reason", "sale");
      expect(builder.in).toHaveBeenCalledWith("source_id", [LINE_A]);
    });

    it("does not round total_cost per layer — passes it through at full stored precision (found 14.08.2026: sale-cogs-builder.ts sums layers across this source plus stock_movements ingredient layers and rounds once at the end; rounding here first silently lost sub-cent remainders, e.g. 0.0240 -> 0.02, before the sum ever saw them)", async () => {
      const builder = makeBuilder({
        data: [consumptionRow({ total_cost: 0.024 })],
        error: null,
      });
      supabaseMock.from.mockReturnValue(builder);

      const result =
        await finishedGoodsReadService.listConsumptionsForSaleLines([
          LINE_A,
        ]);

      expect(result.error).toBeNull();
      expect(result.data?.[0]?.total_cost).toBe(0.024);
    });

    it("maps a joined production_batches array (one-to-many join shape)", async () => {
      supabaseMock.from.mockReturnValue(
        makeBuilder({
          data: [
            consumptionRow({
              production_batches: [
                { batch_number: 2, produced_at: "2026-07-05T08:00:00.000Z" },
              ],
            }),
          ],
          error: null,
        }),
      );

      const result =
        await finishedGoodsReadService.listConsumptionsForSaleLines([
          LINE_A,
        ]);

      expect(result.error).toBeNull();
      expect(result.data?.[0]?.batch_number).toBe(2);
      expect(result.data?.[0]?.produced_at).toBe("2026-07-05T08:00:00.000Z");
    });

    it("falls back to null batch fields when production_batches join is empty", async () => {
      supabaseMock.from.mockReturnValue(
        makeBuilder({
          data: [consumptionRow({ production_batches: [] })],
          error: null,
        }),
      );

      const result =
        await finishedGoodsReadService.listConsumptionsForSaleLines([
          LINE_A,
        ]);

      expect(result.data?.[0]?.batch_number).toBeNull();
      expect(result.data?.[0]?.produced_at).toBeNull();
    });

    it("falls back to null batch fields when production_batches join is null", async () => {
      supabaseMock.from.mockReturnValue(
        makeBuilder({
          data: [consumptionRow({ production_batches: null })],
          error: null,
        }),
      );

      const result =
        await finishedGoodsReadService.listConsumptionsForSaleLines([
          LINE_A,
        ]);

      expect(result.data?.[0]?.batch_number).toBeNull();
      expect(result.data?.[0]?.produced_at).toBeNull();
    });

    it("maps multiple consumption layers across sale lines", async () => {
      supabaseMock.from.mockReturnValue(
        makeBuilder({
          data: [
            consumptionRow({ id: "c-1", source_id: LINE_A }),
            consumptionRow({
              id: "c-2",
              source_id: LINE_B,
              production_batch_id: BATCH_B,
              production_batches: {
                batch_number: 2,
                produced_at: "2026-07-05T08:00:00.000Z",
              },
            }),
          ],
          error: null,
        }),
      );

      const result =
        await finishedGoodsReadService.listConsumptionsForSaleLines([
          LINE_A,
          LINE_B,
        ]);

      expect(result.error).toBeNull();
      expect(result.data).toHaveLength(2);
      expect(result.data?.map((row) => row.sale_line_id)).toEqual([
        LINE_A,
        LINE_B,
      ]);
    });

    it("maps a generic database error to its raw message", async () => {
      supabaseMock.from.mockReturnValue(
        makeBuilder({ data: null, error: { message: "boom" } }),
      );

      const result =
        await finishedGoodsReadService.listConsumptionsForSaleLines([
          LINE_A,
        ]);

      expect(result.data).toBeNull();
      expect(result.error).toBe("boom");
    });
  });
});
