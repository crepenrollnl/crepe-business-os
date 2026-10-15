/**
 * Write-off requests service (sql/157): RPC names and parameters, mapping,
 * errors, and that every read is cost-free.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { supabaseMock, listProductStockMock, getStockLevelsMock } = vi.hoisted(
  () => ({
    supabaseMock: { from: vi.fn(), rpc: vi.fn() },
    listProductStockMock: vi.fn(),
    getStockLevelsMock: vi.fn(),
  }),
);

vi.mock("@/lib/supabase", () => ({
  supabase: supabaseMock,
}));

vi.mock("@/features/finished-goods/services/finished-goods-list-service", () => ({
  finishedGoodsListService: {
    listProductStock: () => listProductStockMock(),
  },
}));

vi.mock("@/features/inventory/services/inventory-service", () => ({
  inventoryService: {
    getStockLevels: () => getStockLevelsMock(),
  },
}));

import {
  WRITE_OFF_REQUEST_LIST_SELECT,
  writeOffRequestService,
} from "./write-off-request-service";

const REQUEST_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ITEM_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TOKEN = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

type QueryResult = { data: unknown; error: unknown; count?: number | null };

function makeBuilder(result: QueryResult) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.select = vi.fn(chain);
  builder.eq = vi.fn(chain);
  builder.order = vi.fn(chain);
  builder.limit = vi.fn(chain);
  builder.then = (
    resolve: (value: QueryResult) => unknown,
    reject?: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(resolve, reject);
  return builder;
}

function row(overrides?: Record<string, unknown>) {
  return {
    id: REQUEST_ID,
    item_type: "ingredient",
    ingredient_id: ITEM_ID,
    product_id: null,
    item_name: "Milk",
    unit: "l",
    quantity: "2.500",
    approved_quantity: null,
    reason: "spoilage",
    note: "Sour",
    status: "pending",
    requested_by: "user-1",
    requested_at: "2026-10-15T10:00:00.000Z",
    decided_by: null,
    decided_at: null,
    decision_note: null,
    is_mine: true,
    ...overrides,
  };
}

describe("writeOffRequestService.listRequests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads write_off_request_list newest first, max 100, with no cost column", async () => {
    const builder = makeBuilder({ data: [row()], error: null });
    supabaseMock.from.mockReturnValue(builder);

    const result = await writeOffRequestService.listRequests();

    expect(supabaseMock.from).toHaveBeenCalledWith("write_off_request_list");
    expect(builder.select).toHaveBeenCalledWith(WRITE_OFF_REQUEST_LIST_SELECT);
    expect(WRITE_OFF_REQUEST_LIST_SELECT).not.toMatch(/cost|value|price/);
    expect(builder.order).toHaveBeenCalledWith("requested_at", { ascending: false });
    expect(builder.limit).toHaveBeenCalledWith(100);
    expect(result.error).toBeNull();
    expect(result.data?.[0]).toMatchObject({
      id: REQUEST_ID,
      item_type: "ingredient",
      quantity: 2.5,
      approved_quantity: null,
      status: "pending",
      is_mine: true,
    });
  });

  it("returns the read error", async () => {
    supabaseMock.from.mockReturnValue(
      makeBuilder({ data: null, error: { message: "Statement timeout." } }),
    );

    const result = await writeOffRequestService.listRequests();

    expect(result.data).toBeNull();
    expect(result.error).toBe("Statement timeout.");
  });
});

describe("writeOffRequestService.countPending", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("head-counts pending rows of write_off_requests", async () => {
    const builder = makeBuilder({ data: null, error: null, count: 4 });
    supabaseMock.from.mockReturnValue(builder);

    const result = await writeOffRequestService.countPending();

    expect(supabaseMock.from).toHaveBeenCalledWith("write_off_requests");
    expect(builder.select).toHaveBeenCalledWith("id", { count: "exact", head: true });
    expect(builder.eq).toHaveBeenCalledWith("status", "pending");
    expect(result.data).toBe(4);
  });
});

describe("writeOffRequestService.requestWriteOff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const input = {
    item_type: "dish" as const,
    item_id: ITEM_ID,
    quantity: 2,
    reason: "damaged" as const,
    note: "  Dropped  ",
    client_request_id: TOKEN,
  };

  it("calls request_write_off with the client request id and a trimmed note", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: { id: REQUEST_ID, status: "pending" },
      error: null,
    });

    const result = await writeOffRequestService.requestWriteOff(input);

    expect(supabaseMock.rpc).toHaveBeenCalledWith("request_write_off", {
      p_item_type: "dish",
      p_item_id: ITEM_ID,
      p_quantity: 2,
      p_reason: "damaged",
      p_note: "Dropped",
      p_client_request_id: TOKEN,
    });
    expect(result.data).toEqual({ id: REQUEST_ID, status: "pending" });
  });

  it("sends an empty note as null", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: { id: REQUEST_ID, status: "pending" },
      error: null,
    });

    await writeOffRequestService.requestWriteOff({ ...input, note: "   " });

    expect(supabaseMock.rpc.mock.calls[0]?.[1]).toMatchObject({ p_note: null });
  });

  it.each([
    [{ quantity: 0 }, "Write-off quantity must be greater than zero."],
    [{ quantity: 1001 }, "Quantity must be between 0.001 and 1000."],
    [{ item_id: "x" }, "Choose the item to write off."],
    [{ note: "a".repeat(501) }, "Note is too long (500 characters at most)."],
  ])("rejects %j without calling the RPC", async (overrides, message) => {
    const result = await writeOffRequestService.requestWriteOff({
      ...input,
      ...overrides,
    });

    expect(result.error).toBe(message);
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it("passes the database message through", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: { message: "This is a dish. Choose it under dishes.", code: "P0001" },
    });

    const result = await writeOffRequestService.requestWriteOff({
      ...input,
      item_type: "finished_good",
    });

    expect(result.error).toBe("This is a dish. Choose it under dishes.");
  });
});

describe("writeOffRequestService.approve / reject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("approves with a corrected quantity and drops the write_off details", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: {
        id: REQUEST_ID,
        status: "approved",
        approved_quantity: 1.5,
        write_off: { id: "w-1", total_value: 12.34 },
      },
      error: null,
    });

    const result = await writeOffRequestService.approve(REQUEST_ID, 1.5);

    expect(supabaseMock.rpc).toHaveBeenCalledWith("approve_write_off_request", {
      p_request_id: REQUEST_ID,
      p_quantity: 1.5,
    });
    expect(result.data).toEqual({
      id: REQUEST_ID,
      status: "approved",
      approved_quantity: 1.5,
    });
    expect(JSON.stringify(result.data)).not.toContain("total_value");
  });

  it("approves as requested with p_quantity null", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: { id: REQUEST_ID, status: "approved", approved_quantity: "2" },
      error: null,
    });

    await writeOffRequestService.approve(REQUEST_ID, null);

    expect(supabaseMock.rpc).toHaveBeenCalledWith("approve_write_off_request", {
      p_request_id: REQUEST_ID,
      p_quantity: null,
    });
  });

  it("returns the server's error for a failed approval (request stays pending)", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: { message: "Insufficient ingredient stock for this write-off.", code: "P0001" },
    });

    const result = await writeOffRequestService.approve(REQUEST_ID, null);

    expect(result.error).toBe("Insufficient ingredient stock for this write-off.");
  });

  it("maps the role guard to a plain sentence", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message: "Insufficient permissions for this action (role: seller).",
        code: "42501",
      },
    });

    const result = await writeOffRequestService.reject(REQUEST_ID, null);

    expect(result.error).toBe(
      "Only the owner or a partner can approve or reject write-off requests.",
    );
  });

  it("rejects with a trimmed note", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: { id: REQUEST_ID, status: "rejected" },
      error: null,
    });

    const result = await writeOffRequestService.reject(REQUEST_ID, "  Not spoiled ");

    expect(supabaseMock.rpc).toHaveBeenCalledWith("reject_write_off_request", {
      p_request_id: REQUEST_ID,
      p_note: "Not spoiled",
    });
    expect(result.data).toEqual({ id: REQUEST_ID, status: "rejected" });
  });

  it("passes the already-decided message through", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: { message: "This request is already approved.", code: "P0001" },
    });

    const result = await writeOffRequestService.reject(REQUEST_ID, null);

    expect(result.error).toBe("This request is already approved.");
  });
});

describe("writeOffRequestService.listItemOptions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds cost-free options: assembly dishes, finished goods stock, active ingredients", async () => {
    const recipes = makeBuilder({
      data: [{ id: "d-1", name: "Crepe", yield_unit: "pcs" }],
      error: null,
    });
    supabaseMock.from.mockReturnValue(recipes);
    listProductStockMock.mockResolvedValue({
      data: [
        {
          product_id: "f-1",
          product_name: "Dough",
          available_quantity: 3,
          yield_unit: "kg",
          average_unit_cost: null,
          remaining_value: null,
          newest_batch_at: null,
          production_status: "available",
        },
      ],
      error: null,
    });
    getStockLevelsMock.mockResolvedValue({
      data: [
        { id: "i-2", name: "Old flour", category_id: null, unit: "kg", current_stock: 0, minimum_stock: 0, active: false, category: null },
        { id: "i-1", name: "Milk", category_id: null, unit: "l", current_stock: 4, minimum_stock: 1, active: true, category: null },
      ],
      error: null,
    });

    const result = await writeOffRequestService.listItemOptions();

    expect(supabaseMock.from).toHaveBeenCalledWith("recipes");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("ingredients");
    expect(recipes.select).toHaveBeenCalledWith("id, name, yield_unit");
    expect(recipes.eq).toHaveBeenCalledWith("is_active", true);
    expect(recipes.eq).toHaveBeenCalledWith("recipe_role", "assembly");
    expect(result.data).toEqual({
      dish: [{ id: "d-1", name: "Crepe", unit: "pcs" }],
      finished_good: [{ id: "f-1", name: "Dough", unit: "kg" }],
      ingredient: [{ id: "i-1", name: "Milk", unit: "l" }],
    });
  });
});
