/**
 * Service-level coverage for allocateFinishedGoods (DEV-023).
 *
 * Allocation must go only through allocate_finished_goods_fifo.
 * The service must not implement FIFO, remaining math, batch updates,
 * or direct ledger inserts.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { supabaseMock } = vi.hoisted(() => {
  const supabaseMock = {
    from: vi.fn(),
    rpc: vi.fn(),
    auth: {
      getUser: vi.fn(),
    },
  };
  return { supabaseMock };
});

vi.mock("@/lib/supabase", () => ({
  supabase: supabaseMock,
}));

import { finishedGoodsService } from "./finished-goods-service";
import type { AllocateFinishedGoodsInput } from "../types/finished-good";

const PRODUCT_ID = "11111111-1111-4111-8111-111111111111";
const SOURCE_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";
const BATCH_ID = "44444444-4444-4444-8444-444444444444";
const CONSUMPTION_ID = "55555555-5555-4555-8555-555555555555";

const insertMock = vi.fn();
const updateMock = vi.fn();
const deleteMock = vi.fn();

function validInput(
  overrides?: Partial<AllocateFinishedGoodsInput>,
): AllocateFinishedGoodsInput {
  return {
    product_id: PRODUCT_ID,
    quantity: 5,
    reason: "sale",
    source_type: "sale_line",
    source_id: SOURCE_ID,
    notes: "  counter sale  ",
    ...overrides,
  };
}

function rpcAllocationPayload() {
  return {
    product_id: PRODUCT_ID,
    requested_quantity: 5,
    allocated_quantity: 5,
    total_cost: 12.5,
    reason: "sale",
    source_type: "sale_line",
    source_id: SOURCE_ID,
    allocations: [
      {
        consumption_id: CONSUMPTION_ID,
        production_batch_id: BATCH_ID,
        quantity: 5,
        unit_cost: 2.5,
        total_cost: 12.5,
        produced_at: "2026-07-20T08:00:00.000Z",
      },
    ],
  };
}

function batchRow() {
  return {
    id: BATCH_ID,
    batch_number: 1,
    finished_good_id: PRODUCT_ID,
    produced_quantity: 20,
    unit_cost: 2.5,
    produced_at: "2026-07-20T08:00:00.000Z",
    created_at: "2026-07-20T08:00:00.000Z",
  };
}

function mockBatchReload(rows = [batchRow()]) {
  const orderSecond = vi.fn().mockResolvedValue({
    data: rows,
    error: null,
  });
  const orderFirst = vi.fn().mockReturnValue({
    order: orderSecond,
  });
  const eqMock = vi.fn().mockReturnValue({
    order: orderFirst,
  });
  const selectMock = vi.fn().mockReturnValue({
    eq: eqMock,
  });

  supabaseMock.from.mockImplementation((table: string) => {
    if (table === "production_batches") {
      return {
        select: selectMock,
        insert: insertMock,
        update: updateMock,
        delete: deleteMock,
      };
    }

    if (table === "finished_goods_batch_consumptions") {
      return {
        select: vi.fn(),
        insert: insertMock,
        update: updateMock,
        delete: deleteMock,
      };
    }

    throw new Error(`Unexpected table: ${table}`);
  });

  return { selectMock, eqMock, orderFirst, orderSecond };
}

describe("finishedGoodsService.allocateFinishedGoods (DEV-023)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertMock.mockReset();
    updateMock.mockReset();
    deleteMock.mockReset();
    supabaseMock.auth.getUser.mockResolvedValue({
      data: { user: { id: USER_ID } },
      error: null,
    });
  });

  it("rejects invalid UX input without calling the RPC", async () => {
    const result = await finishedGoodsService.allocateFinishedGoods(
      validInput({ quantity: 0 }),
    );

    expect(result.data).toBeNull();
    expect(result.error).toBe("Enter a quantity greater than zero.");
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
    expect(supabaseMock.from).not.toHaveBeenCalled();
  });

  it("rejects invalid reason without calling the RPC", async () => {
    const result = await finishedGoodsService.allocateFinishedGoods(
      validInput({
        reason: "return_restock" as AllocateFinishedGoodsInput["reason"],
      }),
    );

    expect(result.data).toBeNull();
    expect(result.error).toBe("Invalid allocation reason.");
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it("rejects missing product id without calling the RPC", async () => {
    const result = await finishedGoodsService.allocateFinishedGoods(
      validInput({ product_id: "not-a-uuid" }),
    );

    expect(result.data).toBeNull();
    expect(result.error).toBe("Product id is required.");
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it("calls only allocate_finished_goods_fifo and returns ServiceResult", async () => {
    mockBatchReload();
    supabaseMock.rpc.mockResolvedValue({
      data: rpcAllocationPayload(),
      error: null,
    });

    const result = await finishedGoodsService.allocateFinishedGoods(
      validInput(),
    );

    expect(result.error).toBeNull();
    expect(result.data).not.toBeNull();
    expect(result.data?.allocation.allocated_quantity).toBe(5);
    expect(result.data?.allocation.total_cost).toBe(12.5);
    expect(result.data?.allocation.allocations).toHaveLength(1);
    expect(result.data?.batches).toHaveLength(1);
    expect(result.data?.batches[0]?.id).toBe(BATCH_ID);

    expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
    expect(supabaseMock.rpc).toHaveBeenCalledWith(
      "allocate_finished_goods_fifo",
      {
        p_product_id: PRODUCT_ID,
        p_quantity: 5,
        p_reason: "sale",
        p_source_type: "sale_line",
        p_source_id: SOURCE_ID,
        p_notes: "counter sale",
        p_created_by: USER_ID,
      },
    );
    expect(supabaseMock.rpc.mock.calls.map((call) => call[0])).toEqual([
      "allocate_finished_goods_fifo",
    ]);
  });

  it("reloads immutable production batches after success", async () => {
    const { selectMock, eqMock } = mockBatchReload();
    supabaseMock.rpc.mockResolvedValue({
      data: rpcAllocationPayload(),
      error: null,
    });

    const result = await finishedGoodsService.allocateFinishedGoods(
      validInput(),
    );

    expect(result.error).toBeNull();
    expect(supabaseMock.from).toHaveBeenCalledWith("production_batches");
    expect(selectMock).toHaveBeenCalledWith(
      "id, batch_number, finished_good_id, produced_quantity, unit_cost, produced_at, created_at",
    );
    expect(eqMock).toHaveBeenCalledWith("finished_good_id", PRODUCT_ID);

    // Remaining is never part of the reloaded read model.
    expect(result.data?.batches[0]).not.toHaveProperty("remaining_quantity");
    expect(result.data?.batches[0]).not.toHaveProperty("remaining");
  });

  it("maps insufficient stock RPC errors", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message: "Insufficient finished goods stock for this product.",
      },
    });

    const result = await finishedGoodsService.allocateFinishedGoods(
      validInput(),
    );

    expect(result.data).toBeNull();
    expect(result.error).toBe("Not enough finished goods in stock.");
    expect(supabaseMock.from).not.toHaveBeenCalled();
  });

  it("maps duplicate-source RPC errors", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message: "This source has already been allocated.",
      },
    });

    const result = await finishedGoodsService.allocateFinishedGoods(
      validInput(),
    );

    expect(result.data).toBeNull();
    expect(result.error).toBe("This item was already allocated.");
  });

  it("maps unique-constraint duplicate errors", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message:
          'duplicate key value violates unique constraint "finished_goods_batch_consumptions_source_batch_uidx"',
      },
    });

    const result = await finishedGoodsService.allocateFinishedGoods(
      validInput(),
    );

    expect(result.data).toBeNull();
    expect(result.error).toBe("This item was already allocated.");
  });

  it("never inserts ledger rows or updates batches directly", async () => {
    mockBatchReload();
    supabaseMock.rpc.mockResolvedValue({
      data: rpcAllocationPayload(),
      error: null,
    });

    await finishedGoodsService.allocateFinishedGoods(validInput());

    const tablesTouched = supabaseMock.from.mock.calls.map((call) => call[0]);
    expect(tablesTouched).toEqual(["production_batches"]);
    expect(tablesTouched).not.toContain("finished_goods_batch_consumptions");
    expect(insertMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("never calculates FIFO locally (RPC owns allocation layers)", async () => {
    mockBatchReload([
      batchRow(),
      {
        ...batchRow(),
        id: "66666666-6666-4666-8666-666666666666",
        batch_number: 2,
        produced_at: "2026-07-21T08:00:00.000Z",
      },
    ]);
    supabaseMock.rpc.mockResolvedValue({
      data: rpcAllocationPayload(),
      error: null,
    });

    const result = await finishedGoodsService.allocateFinishedGoods(
      validInput(),
    );

    // Service returns RPC layers as-is; it does not invent additional layers.
    expect(result.data?.allocation.allocations).toEqual([
      {
        consumption_id: CONSUMPTION_ID,
        production_batch_id: BATCH_ID,
        quantity: 5,
        unit_cost: 2.5,
        total_cost: 12.5,
        produced_at: "2026-07-20T08:00:00.000Z",
      },
    ]);
    expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
    expect(supabaseMock.rpc.mock.calls[0]?.[0]).toBe(
      "allocate_finished_goods_fifo",
    );
  });
});
