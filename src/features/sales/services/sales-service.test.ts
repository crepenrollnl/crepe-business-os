/**
 * Service-level coverage for confirmSale (DEV-027), createDraftSale (DEV-034),
 * and sale line mutations (DEV-035).
 *
 * Confirmation must go only through confirm_sale.
 * Draft creation must go only through create_draft_sale.
 * Line mutations must go only through add/update/delete_sale_line.
 * The service must not call allocate_finished_goods_fifo, mutate ledger /
 * Finished Goods / Sale rows, or calculate COGS / totals locally.
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

import { salesService } from "./sales-service";

const SALE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LINE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PRODUCT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const USER_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const insertMock = vi.fn();
const updateMock = vi.fn();
const deleteMock = vi.fn();

function rpcConfirmPayload(totalCogs = 18.75) {
  return {
    sale_id: SALE_ID,
    total_cogs: totalCogs,
  };
}

function saleRow() {
  return {
    id: SALE_ID,
    sale_number: "S-1001",
    customer_id: null,
    status: "confirmed",
    sale_date: "2026-07-22",
    confirmed_at: "2026-07-22T16:00:00.000Z",
    paid_at: null,
    cancelled_at: null,
    subtotal: 25,
    tax_total: 0,
    total: 25,
    notes: null,
    created_at: "2026-07-22T15:00:00.000Z",
    updated_at: "2026-07-22T16:00:00.000Z",
  };
}

function saleLineRow() {
  return {
    id: LINE_ID,
    sale_id: SALE_ID,
    product_id: PRODUCT_ID,
    quantity: 5,
    unit_price: 5,
    line_total: 25,
    created_at: "2026-07-22T15:00:00.000Z",
  };
}

function mockSaleReload(
  sale = saleRow(),
  lines = [saleLineRow()],
) {
  const saleMaybeSingle = vi.fn().mockResolvedValue({
    data: sale,
    error: null,
  });
  const saleEq = vi.fn().mockReturnValue({
    maybeSingle: saleMaybeSingle,
  });
  const saleSelect = vi.fn().mockReturnValue({
    eq: saleEq,
  });

  const linesOrderSecond = vi.fn().mockResolvedValue({
    data: lines,
    error: null,
  });
  const linesOrderFirst = vi.fn().mockReturnValue({
    order: linesOrderSecond,
  });
  const linesEq = vi.fn().mockReturnValue({
    order: linesOrderFirst,
  });
  const linesSelect = vi.fn().mockReturnValue({
    eq: linesEq,
  });

  supabaseMock.from.mockImplementation((table: string) => {
    if (table === "sales") {
      return {
        select: saleSelect,
        insert: insertMock,
        update: updateMock,
        delete: deleteMock,
      };
    }

    if (table === "sale_lines") {
      return {
        select: linesSelect,
        insert: insertMock,
        update: updateMock,
        delete: deleteMock,
      };
    }

    if (
      table === "finished_goods_batch_consumptions" ||
      table === "production_batches" ||
      table === "finished_goods_batch_availability"
    ) {
      return {
        select: vi.fn(),
        insert: insertMock,
        update: updateMock,
        delete: deleteMock,
      };
    }

    throw new Error(`Unexpected table: ${table}`);
  });

  return {
    saleSelect,
    saleEq,
    saleMaybeSingle,
    linesSelect,
    linesEq,
    linesOrderFirst,
    linesOrderSecond,
  };
}

describe("salesService.confirmSale (DEV-027)", () => {
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
    const result = await salesService.confirmSale("not-a-uuid");

    expect(result.data).toBeNull();
    expect(result.error).toBe("Sale id is required.");
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
    expect(supabaseMock.from).not.toHaveBeenCalled();
    expect(supabaseMock.auth.getUser).not.toHaveBeenCalled();
  });

  it("rejects empty sale id without calling the RPC", async () => {
    const result = await salesService.confirmSale("");

    expect(result.data).toBeNull();
    expect(result.error).toBe("Sale id is required.");
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
    expect(supabaseMock.from).not.toHaveBeenCalled();
  });

  it("requires authentication before calling the RPC", async () => {
    supabaseMock.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: null,
    });

    const result = await salesService.confirmSale(SALE_ID);

    expect(result.data).toBeNull();
    expect(result.error).toBe("You must be signed in to confirm a sale.");
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
    expect(supabaseMock.from).not.toHaveBeenCalled();
  });

  it("calls only confirm_sale and returns ServiceResult", async () => {
    mockSaleReload();
    supabaseMock.rpc.mockResolvedValue({
      data: rpcConfirmPayload(18.75),
      error: null,
    });

    const result = await salesService.confirmSale(SALE_ID);

    expect(result.error).toBeNull();
    expect(result.data).not.toBeNull();
    expect(result.data?.sale.id).toBe(SALE_ID);
    expect(result.data?.sale.status).toBe("confirmed");
    expect(result.data?.sale.lines).toHaveLength(1);
    expect(result.data?.sale.lines[0]?.id).toBe(LINE_ID);
    expect(result.data?.total_cogs).toBe(18.75);

    expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
    expect(supabaseMock.rpc).toHaveBeenCalledWith("confirm_sale", {
      p_sale_id: SALE_ID,
    });
    expect(supabaseMock.rpc.mock.calls.map((call) => call[0])).toEqual([
      "confirm_sale",
    ]);
    expect(supabaseMock.rpc.mock.calls.map((call) => call[0])).not.toContain(
      "allocate_finished_goods_fifo",
    );
  });

  it("reloads Sale + Sale Lines after success", async () => {
    const { saleSelect, saleEq, linesSelect, linesEq } = mockSaleReload();
    supabaseMock.rpc.mockResolvedValue({
      data: rpcConfirmPayload(),
      error: null,
    });

    const result = await salesService.confirmSale(SALE_ID);

    expect(result.error).toBeNull();
    expect(supabaseMock.from).toHaveBeenCalledWith("sales");
    expect(supabaseMock.from).toHaveBeenCalledWith("sale_lines");
    expect(saleSelect).toHaveBeenCalledWith(
      "id, sale_number, customer_id, status, sale_date, confirmed_at, paid_at, cancelled_at, subtotal, tax_total, total, notes, created_at, updated_at",
    );
    expect(saleEq).toHaveBeenCalledWith("id", SALE_ID);
    expect(linesSelect).toHaveBeenCalledWith(
      "id, sale_id, product_id, quantity, unit_price, line_total, created_at",
    );
    expect(linesEq).toHaveBeenCalledWith("sale_id", SALE_ID);

    const tablesTouched = supabaseMock.from.mock.calls.map((call) => call[0]);
    expect(tablesTouched).toEqual(["sales", "sale_lines"]);
    expect(tablesTouched).not.toContain("finished_goods_batch_availability");
    expect(tablesTouched).not.toContain("production_batches");
  });

  it("uses SQL total_cogs as source of truth (never calculates COGS locally)", async () => {
    mockSaleReload();
    supabaseMock.rpc.mockResolvedValue({
      data: rpcConfirmPayload(42.5),
      error: null,
    });

    const result = await salesService.confirmSale(SALE_ID);

    expect(result.error).toBeNull();
    expect(result.data?.total_cogs).toBe(42.5);
    // Sale revenue totals are unrelated to COGS; service does not derive COGS from them.
    expect(result.data?.sale.total).toBe(25);
    expect(result.data?.total_cogs).not.toBe(result.data?.sale.total);
    expect(result.data?.total_cogs).not.toBe(
      result.data?.sale.lines[0]?.line_total,
    );
  });

  it("maps draft-status RPC errors", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message: "Only draft sales can be confirmed.",
      },
    });

    const result = await salesService.confirmSale(SALE_ID);

    expect(result.data).toBeNull();
    expect(result.error).toBe("Only draft sales can be confirmed.");
    expect(supabaseMock.from).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("maps insufficient stock RPC errors", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message: "Insufficient finished goods stock for this product.",
      },
    });

    const result = await salesService.confirmSale(SALE_ID);

    expect(result.data).toBeNull();
    expect(result.error).toBe("Not enough finished goods in stock.");
    expect(supabaseMock.from).not.toHaveBeenCalled();
  });

  it("maps not-found RPC errors", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message: "Sale was not found.",
      },
    });

    const result = await salesService.confirmSale(SALE_ID);

    expect(result.data).toBeNull();
    expect(result.error).toBe("Sale was not found.");
  });

  it("maps no-lines RPC errors", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message: "Sale has no lines to confirm.",
      },
    });

    const result = await salesService.confirmSale(SALE_ID);

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "Add at least one line before confirming this sale.",
    );
  });

  it("maps duplicate allocation RPC errors", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message: "This source has already been allocated.",
      },
    });

    const result = await salesService.confirmSale(SALE_ID);

    expect(result.data).toBeNull();
    expect(result.error).toBe("This sale was already allocated.");
  });

  it("surfaces RPC failure without client-side mutations (rollback semantics)", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message: "Insufficient finished goods stock for this product.",
      },
    });

    const result = await salesService.confirmSale(SALE_ID);

    expect(result.data).toBeNull();
    expect(result.error).not.toBeNull();

    // Client never mutates Sale / ledger / FG after a failed confirm_sale.
    expect(supabaseMock.from).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
    expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
    expect(supabaseMock.rpc.mock.calls[0]?.[0]).toBe("confirm_sale");
  });

  it("never calls allocate_finished_goods_fifo", async () => {
    mockSaleReload();
    supabaseMock.rpc.mockResolvedValue({
      data: rpcConfirmPayload(),
      error: null,
    });

    await salesService.confirmSale(SALE_ID);

    expect(supabaseMock.rpc.mock.calls.map((call) => call[0])).toEqual([
      "confirm_sale",
    ]);
    expect(supabaseMock.rpc).not.toHaveBeenCalledWith(
      "allocate_finished_goods_fifo",
      expect.anything(),
    );
  });

  it("never updates Finished Goods, ledger, or Sale rows directly", async () => {
    mockSaleReload();
    supabaseMock.rpc.mockResolvedValue({
      data: rpcConfirmPayload(),
      error: null,
    });

    await salesService.confirmSale(SALE_ID);

    const tablesTouched = supabaseMock.from.mock.calls.map((call) => call[0]);
    expect(tablesTouched).toEqual(["sales", "sale_lines"]);
    expect(tablesTouched).not.toContain("finished_goods_batch_consumptions");
    expect(tablesTouched).not.toContain("production_batches");
    expect(tablesTouched).not.toContain("finished_goods_batch_availability");
    expect(insertMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });
});

describe("salesService.createDraftSale (DEV-034)", () => {
  const CUSTOMER_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

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

  it("rejects invalid customer_id without calling the RPC", async () => {
    const result = await salesService.createDraftSale({
      customer_id: "not-a-uuid",
    });

    expect(result.data).toBeNull();
    expect(result.error).toBe("Customer id is invalid.");
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
    expect(supabaseMock.from).not.toHaveBeenCalled();
    expect(supabaseMock.auth.getUser).not.toHaveBeenCalled();
  });

  it("requires authentication before calling the RPC", async () => {
    supabaseMock.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: null,
    });

    const result = await salesService.createDraftSale();

    expect(result.data).toBeNull();
    expect(result.error).toBe("You must be signed in to create a sale.");
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
    expect(supabaseMock.from).not.toHaveBeenCalled();
  });

  it("creates a draft sale successfully and returns saleId", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: { sale_id: SALE_ID },
      error: null,
    });

    const result = await salesService.createDraftSale();

    expect(result.error).toBeNull();
    expect(result.data).toEqual({ saleId: SALE_ID });
    expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
    expect(supabaseMock.rpc).toHaveBeenCalledWith("create_draft_sale", {
      p_customer_id: null,
      p_notes: null,
    });
    expect(supabaseMock.from).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("passes nullable customer_id as null by default", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: { sale_id: SALE_ID },
      error: null,
    });

    const result = await salesService.createDraftSale({
      customer_id: null,
      notes: null,
    });

    expect(result.error).toBeNull();
    expect(result.data?.saleId).toBe(SALE_ID);
    expect(supabaseMock.rpc).toHaveBeenCalledWith("create_draft_sale", {
      p_customer_id: null,
      p_notes: null,
    });
  });

  it("passes optional notes and customer_id to the RPC", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: { sale_id: SALE_ID },
      error: null,
    });

    const result = await salesService.createDraftSale({
      customer_id: CUSTOMER_ID,
      notes: "  catering order  ",
    });

    expect(result.error).toBeNull();
    expect(result.data?.saleId).toBe(SALE_ID);
    expect(supabaseMock.rpc).toHaveBeenCalledWith("create_draft_sale", {
      p_customer_id: CUSTOMER_ID,
      p_notes: "catering order",
    });
  });

  it("treats blank notes as null", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: { sale_id: SALE_ID },
      error: null,
    });

    const result = await salesService.createDraftSale({
      notes: "   ",
    });

    expect(result.error).toBeNull();
    expect(supabaseMock.rpc).toHaveBeenCalledWith("create_draft_sale", {
      p_customer_id: null,
      p_notes: null,
    });
  });

  it("maps duplicate sale_number RPC errors", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message: 'duplicate key value violates unique constraint "sales_sale_number_key"',
      },
    });

    const result = await salesService.createDraftSale();

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "Could not generate a unique sale number. Try again.",
    );
    expect(supabaseMock.from).not.toHaveBeenCalled();
  });

  it("maps missing create_draft_sale function errors", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message: "Could not find the function public.create_draft_sale",
      },
    });

    const result = await salesService.createDraftSale();

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "Creating draft sales is not available yet. Apply the create-draft-sale database script and try again.",
    );
  });

  it("rejects invalid RPC payload without reloading", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: { sale_id: "not-a-uuid" },
      error: null,
    });

    const result = await salesService.createDraftSale();

    expect(result.data).toBeNull();
    expect(result.error).toBe("Draft sale created but the response was invalid.");
    expect(supabaseMock.from).not.toHaveBeenCalled();
  });

  it("never calls confirm_sale or allocate_finished_goods_fifo", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: { sale_id: SALE_ID },
      error: null,
    });

    await salesService.createDraftSale();

    expect(supabaseMock.rpc.mock.calls.map((call) => call[0])).toEqual([
      "create_draft_sale",
    ]);
    expect(supabaseMock.rpc).not.toHaveBeenCalledWith(
      "confirm_sale",
      expect.anything(),
    );
    expect(supabaseMock.rpc).not.toHaveBeenCalledWith(
      "allocate_finished_goods_fifo",
      expect.anything(),
    );
  });

  it("never mutates Sale or ledger tables from the client", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: { sale_id: SALE_ID },
      error: null,
    });

    await salesService.createDraftSale({ customer_id: CUSTOMER_ID });

    expect(supabaseMock.from).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });
});

describe("salesService sale line mutations (DEV-035)", () => {
  function saleDocumentPayload(overrides?: {
    quantity?: number;
    unit_price?: number;
    line_total?: number;
    subtotal?: number;
    tax_total?: number;
    total?: number;
    lines?: unknown[];
  }) {
    const quantity = overrides?.quantity ?? 5;
    const unitPrice = overrides?.unit_price ?? 4.5;
    const lineTotal = overrides?.line_total ?? 22.5;
    const subtotal = overrides?.subtotal ?? lineTotal;
    const taxTotal = overrides?.tax_total ?? 0;
    const total = overrides?.total ?? subtotal;

    return {
      sale_id: SALE_ID,
      sale_number: "S-1001",
      status: "draft",
      sale_date: "2026-07-23",
      customer_id: null,
      subtotal,
      tax_total: taxTotal,
      total,
      notes: null,
      confirmed_at: null,
      paid_at: null,
      cancelled_at: null,
      lines:
        overrides?.lines ??
        [
          {
            line_id: LINE_ID,
            product_id: PRODUCT_ID,
            quantity,
            unit_price: unitPrice,
            line_total: lineTotal,
          },
        ],
    };
  }

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

  it("rejects invalid addSaleLine input without calling the RPC", async () => {
    const result = await salesService.addSaleLine({
      sale_id: SALE_ID,
      product_id: PRODUCT_ID,
      quantity: 0,
      unit_price: 4.5,
    });

    expect(result.data).toBeNull();
    expect(result.error).toBe("Enter a quantity greater than zero.");
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
    expect(supabaseMock.from).not.toHaveBeenCalled();
    expect(supabaseMock.auth.getUser).not.toHaveBeenCalled();
  });

  it("rejects negative unit_price without calling the RPC", async () => {
    const result = await salesService.addSaleLine({
      sale_id: SALE_ID,
      product_id: PRODUCT_ID,
      quantity: 2,
      unit_price: -1,
    });

    expect(result.data).toBeNull();
    expect(result.error).toBe("Enter a unit price of zero or greater.");
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it("rejects invalid updateSaleLine input without calling the RPC", async () => {
    const result = await salesService.updateSaleLine({
      sale_line_id: "not-a-uuid",
      quantity: 3,
    });

    expect(result.data).toBeNull();
    expect(result.error).toBe("Sale line id is required.");
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it("rejects invalid deleteSaleLine input without calling the RPC", async () => {
    const result = await salesService.deleteSaleLine({
      sale_line_id: "",
    });

    expect(result.data).toBeNull();
    expect(result.error).toBe("Sale line id is required.");
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it("adds a sale line successfully and returns SaleDetail from the RPC", async () => {
    const payload = saleDocumentPayload({
      quantity: 5,
      unit_price: 4.5,
      line_total: 22.5,
      subtotal: 22.5,
      tax_total: 0,
      total: 22.5,
    });
    supabaseMock.rpc.mockResolvedValue({
      data: payload,
      error: null,
    });

    const result = await salesService.addSaleLine({
      sale_id: SALE_ID,
      product_id: PRODUCT_ID,
      quantity: 5,
      unit_price: 4.5,
    });

    expect(result.error).toBeNull();
    expect(result.data).toEqual({
      sale_id: SALE_ID,
      sale_number: "S-1001",
      status: "draft",
      sale_date: "2026-07-23",
      customer_id: null,
      subtotal: 22.5,
      tax_total: 0,
      total: 22.5,
      confirmed_at: null,
      paid_at: null,
      cancelled_at: null,
      lines: [
        {
          line_id: LINE_ID,
          product_id: PRODUCT_ID,
          quantity: 5,
          unit_price: 4.5,
          line_total: 22.5,
        },
      ],
    });
    expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
    expect(supabaseMock.rpc).toHaveBeenCalledWith("add_sale_line", {
      p_sale_id: SALE_ID,
      p_product_id: PRODUCT_ID,
      p_quantity: 5,
      p_unit_price: 4.5,
    });
    expect(supabaseMock.from).not.toHaveBeenCalled();
  });

  it("updates sale line quantity successfully and returns SaleDetail from the RPC", async () => {
    const payload = saleDocumentPayload({
      quantity: 8,
      unit_price: 4.5,
      line_total: 36,
      subtotal: 36,
      total: 36,
    });
    supabaseMock.rpc.mockResolvedValue({
      data: payload,
      error: null,
    });

    const result = await salesService.updateSaleLine({
      sale_line_id: LINE_ID,
      quantity: 8,
    });

    expect(result.error).toBeNull();
    expect(result.data?.lines[0]?.quantity).toBe(8);
    expect(result.data?.lines[0]?.line_total).toBe(36);
    expect(result.data?.subtotal).toBe(36);
    expect(result.data?.total).toBe(36);
    expect(supabaseMock.rpc).toHaveBeenCalledWith("update_sale_line", {
      p_sale_line_id: LINE_ID,
      p_quantity: 8,
    });
    expect(supabaseMock.from).not.toHaveBeenCalled();
  });

  it("deletes a sale line successfully and returns SaleDetail from the RPC", async () => {
    const payload = saleDocumentPayload({
      lines: [],
      subtotal: 0,
      tax_total: 0,
      total: 0,
    });
    supabaseMock.rpc.mockResolvedValue({
      data: payload,
      error: null,
    });

    const result = await salesService.deleteSaleLine({
      sale_line_id: LINE_ID,
    });

    expect(result.error).toBeNull();
    expect(result.data?.lines).toEqual([]);
    expect(result.data?.subtotal).toBe(0);
    expect(result.data?.total).toBe(0);
    expect(supabaseMock.rpc).toHaveBeenCalledWith("delete_sale_line", {
      p_sale_line_id: LINE_ID,
    });
    expect(supabaseMock.from).not.toHaveBeenCalled();
  });

  it("uses RPC totals as source of truth (never calculates totals locally)", async () => {
    // Intentionally mismatched vs qty * unit_price to prove no client recalculation.
    const payload = saleDocumentPayload({
      quantity: 5,
      unit_price: 4.5,
      line_total: 99.99,
      subtotal: 88.88,
      tax_total: 1.11,
      total: 90,
    });
    supabaseMock.rpc.mockResolvedValue({
      data: payload,
      error: null,
    });

    const result = await salesService.addSaleLine({
      sale_id: SALE_ID,
      product_id: PRODUCT_ID,
      quantity: 5,
      unit_price: 4.5,
    });

    expect(result.error).toBeNull();
    expect(result.data?.lines[0]?.line_total).toBe(99.99);
    expect(result.data?.subtotal).toBe(88.88);
    expect(result.data?.tax_total).toBe(1.11);
    expect(result.data?.total).toBe(90);
    expect(result.data?.lines[0]?.line_total).not.toBe(5 * 4.5);
    expect(result.data?.total).not.toBe(
      (result.data?.subtotal ?? 0) + (result.data?.tax_total ?? 0),
    );
  });

  it("maps draft-only RPC errors for addSaleLine", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message: "Only draft sales can be modified.",
      },
    });

    const result = await salesService.addSaleLine({
      sale_id: SALE_ID,
      product_id: PRODUCT_ID,
      quantity: 2,
      unit_price: 3,
    });

    expect(result.data).toBeNull();
    expect(result.error).toBe("Only draft sales can be modified.");
    expect(supabaseMock.from).not.toHaveBeenCalled();
  });

  it("maps product-not-found RPC errors", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message: "Product was not found.",
      },
    });

    const result = await salesService.addSaleLine({
      sale_id: SALE_ID,
      product_id: PRODUCT_ID,
      quantity: 2,
      unit_price: 3,
    });

    expect(result.data).toBeNull();
    expect(result.error).toBe("Product was not found.");
  });

  it("maps sale-line-not-found RPC errors for updateSaleLine", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message: "Sale line was not found.",
      },
    });

    const result = await salesService.updateSaleLine({
      sale_line_id: LINE_ID,
      quantity: 4,
    });

    expect(result.data).toBeNull();
    expect(result.error).toBe("Sale line was not found.");
  });

  it("maps missing sale-line RPC function errors", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message: "Could not find the function public.add_sale_line",
      },
    });

    const result = await salesService.addSaleLine({
      sale_id: SALE_ID,
      product_id: PRODUCT_ID,
      quantity: 1,
      unit_price: 2,
    });

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "Sale line management is not available yet. Apply the sale-line-management database script and try again.",
    );
  });

  it("never calls confirm_sale or allocate_finished_goods_fifo", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: saleDocumentPayload(),
      error: null,
    });

    await salesService.addSaleLine({
      sale_id: SALE_ID,
      product_id: PRODUCT_ID,
      quantity: 1,
      unit_price: 2,
    });
    await salesService.updateSaleLine({
      sale_line_id: LINE_ID,
      quantity: 2,
    });
    await salesService.deleteSaleLine({
      sale_line_id: LINE_ID,
    });

    expect(supabaseMock.rpc.mock.calls.map((call) => call[0])).toEqual([
      "add_sale_line",
      "update_sale_line",
      "delete_sale_line",
    ]);
    expect(supabaseMock.rpc).not.toHaveBeenCalledWith(
      "confirm_sale",
      expect.anything(),
    );
    expect(supabaseMock.rpc).not.toHaveBeenCalledWith(
      "allocate_finished_goods_fifo",
      expect.anything(),
    );
  });

  it("never mutates Sale, ledger, or inventory tables from the client", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: saleDocumentPayload(),
      error: null,
    });

    await salesService.addSaleLine({
      sale_id: SALE_ID,
      product_id: PRODUCT_ID,
      quantity: 1,
      unit_price: 2,
    });
    await salesService.updateSaleLine({
      sale_line_id: LINE_ID,
      quantity: 3,
    });
    await salesService.deleteSaleLine({
      sale_line_id: LINE_ID,
    });

    expect(supabaseMock.from).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });
});
