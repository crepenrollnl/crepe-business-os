/**
 * Production Batch service coverage (DEV-015 / DEV-103, Фаза 3 gap #1).
 *
 * production-batch-service.ts had zero tests before this file — worse, it
 * was explicitly vi.mock()'d in all three production-session-service
 * integration tests, so its real code never ran under any existing test.
 *
 * Despite the file's docstring mentioning "creation", the actual code here
 * is READ-ONLY: it lists already-created immutable production_batches for
 * a session and enriches them with a product name, a reconstructed
 * ingredient cost breakdown, and Finished Goods valuation (remaining
 * quantity/value). It never creates, updates, or recalculates a frozen
 * unit_cost — creation happens in the complete_production_session SQL RPC
 * (sql/007), outside this file. Tests below cover the real behavior:
 * total_cost derivation (both the valuation-view path and the frozen
 * batch.unit_cost fallback), remaining quantity/value nulling, graceful
 * degradation when the optional enrichment queries fail, and the two
 * queries whose failure does fail the whole call.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { supabaseMock, finishedGoodsReadServiceMock } = vi.hoisted(() => ({
  supabaseMock: { from: vi.fn() },
  finishedGoodsReadServiceMock: { listAvailableBatchesByIds: vi.fn() },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: supabaseMock,
}));

vi.mock("@/features/finished-goods/services/finished-goods-read-service", () => ({
  finishedGoodsReadService: finishedGoodsReadServiceMock,
}));

import { productionBatchService } from "./production-batch-service";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const BATCH_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LINE_ID = "22222222-2222-4222-8222-222222222222";
const RECIPE_ID = "33333333-3333-4333-8333-333333333333";
const INGREDIENT_ID = "44444444-4444-4444-8444-444444444444";

/**
 * Minimal thenable query-builder stub matching supabase-js's chainable
 * PostgrestFilterBuilder shape: select/eq/in/order all return the same
 * builder, and the builder itself resolves like a Promise when awaited.
 * Same pattern as finished-goods-read-service.test.ts.
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

/**
 * Configure supabaseMock.from to return a per-table builder. Tables not
 * listed default to an empty successful result so each test only has to
 * specify the tables it actually cares about.
 */
function mockTables(
  tables: Record<string, { data: unknown; error: unknown }>,
) {
  supabaseMock.from.mockImplementation((table: string) => {
    const result = tables[table] ?? { data: [], error: null };
    return makeBuilder(result);
  });
}

function batchRow(overrides?: Record<string, unknown>) {
  return {
    id: BATCH_ID,
    batch_number: 1,
    production_session_id: SESSION_ID,
    production_session_line_id: LINE_ID,
    finished_good_id: RECIPE_ID,
    recipe_id: RECIPE_ID,
    produced_quantity: 10,
    unit_cost: 2.5,
    produced_at: "2026-08-01T08:00:00.000Z",
    created_at: "2026-08-01T08:00:00.000Z",
    ...overrides,
  };
}

function sessionLineRow(overrides?: Record<string, unknown>) {
  return {
    id: LINE_ID,
    product_name: "Chicken Crepe",
    yield_unit: "pcs",
    ...overrides,
  };
}

function availabilityRow(overrides?: Record<string, unknown>) {
  return {
    production_batch_id: BATCH_ID,
    produced_quantity: 10,
    available_quantity: 4,
    unit_cost: 2.5,
    total_batch_cost: 25,
    remaining_value: 10,
    ...overrides,
  };
}

describe("productionBatchService.listBySessionId (DEV-015 / DEV-103)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    finishedGoodsReadServiceMock.listAvailableBatchesByIds.mockResolvedValue({
      data: [],
      error: null,
    });
  });

  it("returns an empty list without querying anything else when the session has no batches", async () => {
    mockTables({ production_batches: { data: [], error: null } });

    const result = await productionBatchService.listBySessionId(SESSION_ID);

    expect(result.error).toBeNull();
    expect(result.data).toEqual([]);
    expect(supabaseMock.from).toHaveBeenCalledTimes(1);
    expect(supabaseMock.from).toHaveBeenCalledWith("production_batches");
    expect(
      finishedGoodsReadServiceMock.listAvailableBatchesByIds,
    ).not.toHaveBeenCalled();
  });

  it("fails the whole call when loading production_batches errors", async () => {
    mockTables({
      production_batches: {
        data: null,
        error: { message: "connection refused" },
      },
    });

    const result = await productionBatchService.listBySessionId(SESSION_ID);

    expect(result.data).toBeNull();
    expect(result.error).toBe("connection refused");
  });

  it("fails the whole call when loading production_session_lines errors", async () => {
    mockTables({
      production_batches: { data: [batchRow()], error: null },
      production_session_lines: {
        data: null,
        error: { message: "line lookup failed" },
      },
    });

    const result = await productionBatchService.listBySessionId(SESSION_ID);

    expect(result.data).toBeNull();
    expect(result.error).toBe("line lookup failed");
  });

  it("uses the finished-goods valuation total when a matching availability row exists, and populates remaining quantity/value", async () => {
    mockTables({
      production_batches: { data: [batchRow()], error: null },
      production_session_lines: { data: [sessionLineRow()], error: null },
    });
    finishedGoodsReadServiceMock.listAvailableBatchesByIds.mockResolvedValue({
      data: [availabilityRow()],
      error: null,
    });

    const result = await productionBatchService.listBySessionId(SESSION_ID);

    expect(result.error).toBeNull();
    expect(
      finishedGoodsReadServiceMock.listAvailableBatchesByIds,
    ).toHaveBeenCalledWith([BATCH_ID]);
    expect(result.data?.[0]).toMatchObject({
      product_name: "Chicken Crepe",
      yield_unit: "pcs",
      total_cost: 25,
      remaining_quantity: 4,
      remaining_value: 10,
      has_valuation: true,
    });
  });

  it("falls back to deriving total_cost from the frozen batch unit_cost when no availability row matches, and nulls remaining quantity/value", async () => {
    mockTables({
      production_batches: {
        data: [batchRow({ produced_quantity: 8, unit_cost: 3.25 })],
        error: null,
      },
      production_session_lines: { data: [sessionLineRow()], error: null },
    });
    finishedGoodsReadServiceMock.listAvailableBatchesByIds.mockResolvedValue({
      data: [], // no matching availability row for this batch
      error: null,
    });

    const result = await productionBatchService.listBySessionId(SESSION_ID);

    const batch = result.data?.[0];
    expect(batch?.total_cost).toBe(26); // 8 x 3.25, derived from the frozen batch fields
    expect(batch?.remaining_quantity).toBeNull();
    expect(batch?.remaining_value).toBeNull();
    expect(batch?.has_valuation).toBe(true);
  });

  it("reports has_valuation = false and a zero total_cost when neither a valuation row nor a valid frozen unit_cost is available", async () => {
    // production_batches.unit_cost is typed number | string (defensive
    // mapping for whatever the row actually contains) -- a non-numeric
    // string exercises the !Number.isFinite branch.
    mockTables({
      production_batches: {
        data: [batchRow({ unit_cost: "not-a-number" })],
        error: null,
      },
      production_session_lines: { data: [sessionLineRow()], error: null },
    });
    finishedGoodsReadServiceMock.listAvailableBatchesByIds.mockResolvedValue({
      data: [],
      error: null,
    });

    const result = await productionBatchService.listBySessionId(SESSION_ID);

    const batch = result.data?.[0];
    expect(batch?.has_valuation).toBe(false);
    expect(batch?.total_cost).toBe(0);
  });

  it("degrades gracefully (still returns frozen totals) when the finished-goods valuation lookup itself errors", async () => {
    mockTables({
      production_batches: { data: [batchRow()], error: null },
      production_session_lines: { data: [sessionLineRow()], error: null },
    });
    finishedGoodsReadServiceMock.listAvailableBatchesByIds.mockResolvedValue({
      data: null,
      error: "valuation lookup failed",
    });

    const result = await productionBatchService.listBySessionId(SESSION_ID);

    // The overall call must not fail -- valuation is enrichment, not a
    // required input, same as the cost breakdown below.
    expect(result.error).toBeNull();
    const batch = result.data?.[0];
    expect(batch?.total_cost).toBe(25); // 10 x 2.5, derived from the frozen batch fields
    expect(batch?.remaining_quantity).toBeNull();
    expect(batch?.has_valuation).toBe(true);
  });

  it('falls back to "Finished good" / empty yield unit when no session line matches the batch', async () => {
    mockTables({
      production_batches: { data: [batchRow()], error: null },
      production_session_lines: { data: [], error: null }, // no matching line
    });

    const result = await productionBatchService.listBySessionId(SESSION_ID);

    const batch = result.data?.[0];
    expect(batch?.product_name).toBe("Finished good");
    expect(batch?.yield_unit).toBe("");
  });

  it("reconstructs the ingredient cost breakdown from frozen stock-movement costs scaled to the actual produced quantity", async () => {
    mockTables({
      production_batches: {
        data: [batchRow({ produced_quantity: 20 })],
        error: null,
      },
      production_session_lines: { data: [sessionLineRow()], error: null },
      stock_movements: {
        data: [{ ingredient_id: INGREDIENT_ID, unit_cost: 0.5 }],
        error: null,
      },
      recipes: { data: [{ id: RECIPE_ID, yield_quantity: 10 }], error: null },
      recipe_items: {
        data: [
          {
            recipe_id: RECIPE_ID,
            ingredient_id: INGREDIENT_ID,
            quantity: 2,
            unit: "kg",
          },
        ],
        error: null,
      },
      ingredients: {
        data: [{ id: INGREDIENT_ID, name: "Flour", unit: "kg" }],
        error: null,
      },
    });

    const result = await productionBatchService.listBySessionId(SESSION_ID);

    // BOM says 2kg per 10 portions (yield); this batch produced 20 -> scaled
    // consumption = 2 x (20 / 10) = 4kg, at the frozen unit cost of 0.5/kg.
    expect(result.data?.[0]?.cost_breakdown).toEqual([
      expect.objectContaining({
        ingredient_id: INGREDIENT_ID,
        ingredient_name: "Flour",
        consumed_quantity: 4,
        unit: "kg",
        inventory_unit_cost: 0.5,
        line_cost: 2,
      }),
    ]);
  });

  it("degrades the cost breakdown to an empty array (without failing the call) when no frozen ingredient costs were recorded", async () => {
    mockTables({
      production_batches: { data: [batchRow()], error: null },
      production_session_lines: { data: [sessionLineRow()], error: null },
      stock_movements: { data: [], error: null }, // nothing frozen for this session
    });

    const result = await productionBatchService.listBySessionId(SESSION_ID);

    expect(result.error).toBeNull();
    expect(result.data?.[0]?.cost_breakdown).toEqual([]);
  });

  it("returns the thrown error's message as a fallback when an unexpected exception is thrown", async () => {
    supabaseMock.from.mockImplementation(() => {
      throw new Error("unexpected batch listing failure");
    });

    const result = await productionBatchService.listBySessionId(SESSION_ID);

    expect(result.data).toBeNull();
    expect(result.error).toBe("unexpected batch listing failure");
  });
});
