/**
 * Service-level coverage for salesReadService (DEV-029).
 *
 * List/detail reads must go only through sales_list_view / sale_details_view.
 * Documented base-table exceptions: listQueuedSales (kitchen queue) and
 * getSoldQuantityByProductId (POS/Quick Sale tile ranking).
 * The service must not call RPCs, recalculate totals, compute COGS, or
 * implement FIFO.
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

import { salesReadService } from "./sales-read-service";

const SALE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SALE_ID_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LINE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const LINE_ID_2 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const PRODUCT_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const insertMock = vi.fn();
const updateMock = vi.fn();
const deleteMock = vi.fn();

const LIST_SELECT =
  "sale_id, sale_number, status, sale_date, customer_id, subtotal, tax_total, total, confirmed_at, paid_at, cancelled_at";

const DETAILS_SELECT =
  "sale_id, sale_number, status, sale_date, customer_id, subtotal, tax_total, total, confirmed_at, paid_at, cancelled_at, line_id, product_id, quantity, unit_price, line_total, discount_type, discount_value, discount_amount";

function listRow(overrides?: Record<string, unknown>) {
  return {
    sale_id: SALE_ID,
    sale_number: "S-1001",
    status: "confirmed",
    sale_date: "2026-07-22",
    customer_id: null,
    subtotal: "25",
    tax_total: "0",
    total: "25",
    confirmed_at: "2026-07-22T16:00:00.000Z",
    paid_at: null,
    cancelled_at: null,
    ...overrides,
  };
}

function detailsRow(overrides?: Record<string, unknown>) {
  return {
    sale_id: SALE_ID,
    sale_number: "S-1001",
    status: "confirmed",
    sale_date: "2026-07-22",
    customer_id: null,
    subtotal: "25",
    tax_total: "0",
    total: "25",
    confirmed_at: "2026-07-22T16:00:00.000Z",
    paid_at: null,
    cancelled_at: null,
    line_id: LINE_ID,
    product_id: PRODUCT_ID,
    quantity: "5",
    unit_price: "5",
    line_total: "25",
    ...overrides,
  };
}

function emptyDraftDetailsRow() {
  return detailsRow({
    status: "draft",
    confirmed_at: null,
    subtotal: "0",
    tax_total: "0",
    total: "0",
    line_id: null,
    product_id: null,
    quantity: null,
    unit_price: null,
    line_total: null,
  });
}

function forbidBaseTables(table: string) {
  if (
    table === "sales" ||
    table === "sale_lines" ||
    table === "finished_goods_batch_consumptions" ||
    table === "production_batches" ||
    table === "finished_goods_batch_availability"
  ) {
    throw new Error(`Base table queried: ${table}`);
  }
}

function mockListView(rows: ReturnType<typeof listRow>[], error: unknown = null) {
  const orderSecond = vi.fn().mockResolvedValue({
    data: error ? null : rows,
    error,
  });
  const orderFirst = vi.fn().mockReturnValue({
    order: orderSecond,
  });
  const selectMock = vi.fn().mockReturnValue({
    order: orderFirst,
  });

  supabaseMock.from.mockImplementation((table: string) => {
    forbidBaseTables(table);

    if (table === "sales_list_view") {
      return {
        select: selectMock,
        insert: insertMock,
        update: updateMock,
        delete: deleteMock,
      };
    }

    throw new Error(`Unexpected table: ${table}`);
  });

  return { selectMock, orderFirst, orderSecond };
}

function mockDetailsView(
  rows: ReturnType<typeof detailsRow>[],
  error: unknown = null,
) {
  const orderMock = vi.fn().mockResolvedValue({
    data: error ? null : rows,
    error,
  });
  const eqMock = vi.fn().mockReturnValue({
    order: orderMock,
  });
  const selectMock = vi.fn().mockReturnValue({
    eq: eqMock,
  });

  supabaseMock.from.mockImplementation((table: string) => {
    forbidBaseTables(table);

    if (table === "sale_details_view") {
      return {
        select: selectMock,
        insert: insertMock,
        update: updateMock,
        delete: deleteMock,
      };
    }

    throw new Error(`Unexpected table: ${table}`);
  });

  return { selectMock, eqMock, orderMock };
}

describe("salesReadService.listSales (DEV-029)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertMock.mockReset();
    updateMock.mockReset();
    deleteMock.mockReset();
  });

  it("queries only sales_list_view", async () => {
    const { selectMock, orderFirst, orderSecond } = mockListView([listRow()]);

    const result = await salesReadService.listSales();

    expect(result.error).toBeNull();
    expect(supabaseMock.from).toHaveBeenCalledTimes(1);
    expect(supabaseMock.from).toHaveBeenCalledWith("sales_list_view");
    expect(selectMock).toHaveBeenCalledWith(LIST_SELECT);
    expect(orderFirst).toHaveBeenCalledWith("sale_date", { ascending: false });
    expect(orderSecond).toHaveBeenCalledWith("sale_id", { ascending: true });

    const tablesTouched = supabaseMock.from.mock.calls.map((call) => call[0]);
    expect(tablesTouched).toEqual(["sales_list_view"]);
    expect(tablesTouched).not.toContain("sales");
    expect(tablesTouched).not.toContain("sale_lines");
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("returns mapped SaleListItem[]", async () => {
    mockListView([
      listRow(),
      listRow({
        sale_id: SALE_ID_2,
        sale_number: "S-1000",
        status: "draft",
        sale_date: "2026-07-21",
        subtotal: 10,
        tax_total: 2,
        total: 12,
        confirmed_at: null,
      }),
    ]);

    const result = await salesReadService.listSales();

    expect(result.error).toBeNull();
    expect(result.data).toEqual([
      {
        sale_id: SALE_ID,
        sale_number: "S-1001",
        status: "confirmed",
        sale_date: "2026-07-22",
        customer_id: null,
        subtotal: 25,
        tax_total: 0,
        total: 25,
        confirmed_at: "2026-07-22T16:00:00.000Z",
        paid_at: null,
        cancelled_at: null,
      },
      {
        sale_id: SALE_ID_2,
        sale_number: "S-1000",
        status: "draft",
        sale_date: "2026-07-21",
        customer_id: null,
        subtotal: 10,
        tax_total: 2,
        total: 12,
        confirmed_at: null,
        paid_at: null,
        cancelled_at: null,
      },
    ]);
  });

  it("maps DB errors", async () => {
    mockListView([], {
      message: 'relation "sales_list_view" does not exist',
      code: "42P01",
    });

    const result = await salesReadService.listSales();

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "Sales read model is not available yet. Apply the sales read-model database script and try again.",
    );
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it("never queries base tables, calls RPC, or recalculates totals", async () => {
    mockListView([
      listRow({
        subtotal: "100",
        tax_total: "20",
        total: "999",
      }),
    ]);

    const result = await salesReadService.listSales();

    expect(result.error).toBeNull();
    // Totals come from the view as-is — never recomputed from lines.
    expect(result.data?.[0]?.total).toBe(999);
    expect(result.data?.[0]?.subtotal).toBe(100);
    expect(result.data?.[0]?.tax_total).toBe(20);

    const tablesTouched = supabaseMock.from.mock.calls.map((call) => call[0]);
    expect(tablesTouched).toEqual(["sales_list_view"]);
    expect(tablesTouched).not.toContain("sales");
    expect(tablesTouched).not.toContain("sale_lines");
    expect(tablesTouched).not.toContain("finished_goods_batch_consumptions");
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
    expect(supabaseMock.rpc).not.toHaveBeenCalledWith(
      "confirm_sale",
      expect.anything(),
    );
    expect(supabaseMock.rpc).not.toHaveBeenCalledWith(
      "allocate_finished_goods_fifo",
      expect.anything(),
    );
  });
});

function mockWindowView(
  rows: ReturnType<typeof listRow>[],
  error: unknown = null,
) {
  const orderSecond = vi.fn().mockResolvedValue({
    data: error ? null : rows,
    error,
  });
  const orderFirst = vi.fn().mockReturnValue({
    order: orderSecond,
  });
  const lteMock = vi.fn().mockReturnValue({
    order: orderFirst,
  });
  const gteMock = vi.fn().mockReturnValue({
    lte: lteMock,
  });
  const inMock = vi.fn().mockReturnValue({
    gte: gteMock,
  });
  const selectMock = vi.fn().mockReturnValue({
    in: inMock,
  });

  supabaseMock.from.mockImplementation((table: string) => {
    forbidBaseTables(table);

    if (table === "sales_list_view") {
      return {
        select: selectMock,
        insert: insertMock,
        update: updateMock,
        delete: deleteMock,
      };
    }

    throw new Error(`Unexpected table: ${table}`);
  });

  return { selectMock, inMock, gteMock, lteMock, orderFirst, orderSecond };
}

describe("salesReadService.listSalesConfirmedInWindow", () => {
  const OPENED_AT = "2026-08-18T08:00:00.000Z";
  const CLOSED_AT = "2026-08-18T18:00:00.000Z";
  const NOW = "2026-08-18T21:00:00.000Z";

  beforeEach(() => {
    vi.clearAllMocks();
    insertMock.mockReset();
    updateMock.mockReset();
    deleteMock.mockReset();
    vi.useRealTimers();
  });

  it("rejects empty openedAt without querying", async () => {
    const result = await salesReadService.listSalesConfirmedInWindow(
      "  ",
      CLOSED_AT,
    );

    expect(result.data).toBeNull();
    expect(result.error).toBe("Shift opened at is required.");
    expect(supabaseMock.from).not.toHaveBeenCalled();
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it("queries only sales_list_view for a closed window", async () => {
    const { selectMock, inMock, gteMock, lteMock, orderFirst, orderSecond } =
      mockWindowView([listRow()]);

    const result = await salesReadService.listSalesConfirmedInWindow(
      OPENED_AT,
      CLOSED_AT,
    );

    expect(result.error).toBeNull();
    expect(supabaseMock.from).toHaveBeenCalledTimes(1);
    expect(supabaseMock.from).toHaveBeenCalledWith("sales_list_view");
    expect(selectMock).toHaveBeenCalledWith(LIST_SELECT);
    expect(inMock).toHaveBeenCalledWith("status", ["confirmed", "paid"]);
    expect(gteMock).toHaveBeenCalledWith("confirmed_at", OPENED_AT);
    expect(lteMock).toHaveBeenCalledWith("confirmed_at", CLOSED_AT);
    expect(orderFirst).toHaveBeenCalledWith("confirmed_at", {
      ascending: false,
    });
    expect(orderSecond).toHaveBeenCalledWith("sale_id", { ascending: true });

    const tablesTouched = supabaseMock.from.mock.calls.map((call) => call[0]);
    expect(tablesTouched).toEqual(["sales_list_view"]);
    expect(tablesTouched).not.toContain("sales");
    expect(tablesTouched).not.toContain("sale_lines");
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("uses now as the window end when the shift is still open", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));

    const { lteMock } = mockWindowView([listRow()]);

    const result = await salesReadService.listSalesConfirmedInWindow(
      OPENED_AT,
      null,
    );

    expect(result.error).toBeNull();
    expect(lteMock).toHaveBeenCalledWith("confirmed_at", NOW);

    vi.useRealTimers();
  });

  it("returns mapped SaleListItem[]", async () => {
    mockWindowView([
      listRow(),
      listRow({
        sale_id: SALE_ID_2,
        sale_number: "S-1002",
        status: "paid",
        confirmed_at: "2026-08-18T12:00:00.000Z",
        paid_at: "2026-08-18T12:05:00.000Z",
        total: "40",
      }),
    ]);

    const result = await salesReadService.listSalesConfirmedInWindow(
      OPENED_AT,
      CLOSED_AT,
    );

    expect(result.error).toBeNull();
    expect(result.data).toEqual([
      {
        sale_id: SALE_ID,
        sale_number: "S-1001",
        status: "confirmed",
        sale_date: "2026-07-22",
        customer_id: null,
        subtotal: 25,
        tax_total: 0,
        total: 25,
        confirmed_at: "2026-07-22T16:00:00.000Z",
        paid_at: null,
        cancelled_at: null,
      },
      {
        sale_id: SALE_ID_2,
        sale_number: "S-1002",
        status: "paid",
        sale_date: "2026-07-22",
        customer_id: null,
        subtotal: 25,
        tax_total: 0,
        total: 40,
        confirmed_at: "2026-08-18T12:00:00.000Z",
        paid_at: "2026-08-18T12:05:00.000Z",
        cancelled_at: null,
      },
    ]);
  });

  it("maps DB errors", async () => {
    mockWindowView([], {
      message: 'relation "sales_list_view" does not exist',
      code: "42P01",
    });

    const result = await salesReadService.listSalesConfirmedInWindow(
      OPENED_AT,
      CLOSED_AT,
    );

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "Sales read model is not available yet. Apply the sales read-model database script and try again.",
    );
  });

  it("never queries base tables, calls RPC, or recalculates totals", async () => {
    mockWindowView([
      listRow({
        subtotal: "100",
        tax_total: "20",
        total: "999",
      }),
    ]);

    const result = await salesReadService.listSalesConfirmedInWindow(
      OPENED_AT,
      CLOSED_AT,
    );

    expect(result.error).toBeNull();
    expect(result.data?.[0]?.total).toBe(999);
    expect(result.data?.[0]?.subtotal).toBe(100);
    expect(result.data?.[0]?.tax_total).toBe(20);

    const tablesTouched = supabaseMock.from.mock.calls.map((call) => call[0]);
    expect(tablesTouched).toEqual(["sales_list_view"]);
    expect(tablesTouched).not.toContain("sales");
    expect(tablesTouched).not.toContain("sale_lines");
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });
});

describe("salesReadService.getSale (DEV-029)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertMock.mockReset();
    updateMock.mockReset();
    deleteMock.mockReset();
  });

  it("rejects invalid UUID without querying", async () => {
    const result = await salesReadService.getSale("not-a-uuid");

    expect(result.data).toBeNull();
    expect(result.error).toBe("Sale id is required.");
    expect(supabaseMock.from).not.toHaveBeenCalled();
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it("rejects empty sale id without querying", async () => {
    const result = await salesReadService.getSale("");

    expect(result.data).toBeNull();
    expect(result.error).toBe("Sale id is required.");
    expect(supabaseMock.from).not.toHaveBeenCalled();
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it("queries only sale_details_view", async () => {
    const { selectMock, eqMock, orderMock } = mockDetailsView([detailsRow()]);

    const result = await salesReadService.getSale(SALE_ID);

    expect(result.error).toBeNull();
    expect(supabaseMock.from).toHaveBeenCalledTimes(1);
    expect(supabaseMock.from).toHaveBeenCalledWith("sale_details_view");
    expect(selectMock).toHaveBeenCalledWith(DETAILS_SELECT);
    expect(eqMock).toHaveBeenCalledWith("sale_id", SALE_ID);
    expect(orderMock).toHaveBeenCalledWith("line_id", { ascending: true });

    const tablesTouched = supabaseMock.from.mock.calls.map((call) => call[0]);
    expect(tablesTouched).toEqual(["sale_details_view"]);
    expect(tablesTouched).not.toContain("sales");
    expect(tablesTouched).not.toContain("sale_lines");
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("returns header + lines", async () => {
    mockDetailsView([
      detailsRow({
        subtotal: "35",
        total: "35",
      }),
      detailsRow({
        line_id: LINE_ID_2,
        product_id: PRODUCT_ID,
        quantity: "2",
        unit_price: "5",
        line_total: "10",
        subtotal: "35",
        total: "35",
      }),
    ]);

    const result = await salesReadService.getSale(SALE_ID);

    expect(result.error).toBeNull();
    expect(result.data).toEqual({
      sale_id: SALE_ID,
      sale_number: "S-1001",
      status: "confirmed",
      sale_date: "2026-07-22",
      customer_id: null,
      subtotal: 35,
      tax_total: 0,
      total: 35,
      confirmed_at: "2026-07-22T16:00:00.000Z",
      paid_at: null,
      cancelled_at: null,
      discount_type: null,
      discount_value: null,
      discount_amount: null,
      lines: [
        {
          line_id: LINE_ID,
          product_id: PRODUCT_ID,
          quantity: 5,
          unit_price: 5,
          line_total: 25,
        },
        {
          line_id: LINE_ID_2,
          product_id: PRODUCT_ID,
          quantity: 2,
          unit_price: 5,
          line_total: 10,
        },
      ],
    });
  });

  it("maps header discount columns from sale_details_view", async () => {
    mockDetailsView([
      detailsRow({
        discount_type: "amount",
        discount_value: "1.00",
        discount_amount: "1.00",
        subtotal: "14.08",
        tax_total: "1.27",
        total: "15.35",
        line_total: "10.23",
        unit_price: "10.90",
        quantity: "1",
      }),
    ]);

    const result = await salesReadService.getSale(SALE_ID);

    expect(result.error).toBeNull();
    expect(result.data?.discount_type).toBe("amount");
    expect(result.data?.discount_value).toBe(1);
    expect(result.data?.discount_amount).toBe(1);
    expect(result.data?.total).toBe(15.35);
  });

  it("empty draft returns lines: []", async () => {
    mockDetailsView([emptyDraftDetailsRow()]);

    const result = await salesReadService.getSale(SALE_ID);

    expect(result.error).toBeNull();
    expect(result.data?.status).toBe("draft");
    expect(result.data?.lines).toEqual([]);
    expect(result.data?.sale_id).toBe(SALE_ID);
  });

  it("returns not found when view has no rows", async () => {
    mockDetailsView([]);

    const result = await salesReadService.getSale(SALE_ID);

    expect(result.data).toBeNull();
    expect(result.error).toBe("Sale was not found.");
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it("maps DB errors", async () => {
    mockDetailsView([], {
      message: 'relation "sale_details_view" does not exist',
      code: "42P01",
    });

    const result = await salesReadService.getSale(SALE_ID);

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "Sales read model is not available yet. Apply the sales read-model database script and try again.",
    );
  });

  it("never queries base tables, calls RPC, recalculates totals, COGS, or FIFO", async () => {
    mockDetailsView([
      detailsRow({
        subtotal: "10",
        tax_total: "1",
        total: "777",
        quantity: "5",
        unit_price: "5",
        line_total: "25",
      }),
    ]);

    const result = await salesReadService.getSale(SALE_ID);

    expect(result.error).toBeNull();
    // Header totals come from the view — never sum(line_total) or invent COGS.
    expect(result.data?.total).toBe(777);
    expect(result.data?.total).not.toBe(result.data?.lines[0]?.line_total);
    expect(result.data).not.toHaveProperty("total_cogs");
    expect(result.data).not.toHaveProperty("cogs");
    expect(result.data?.lines[0]).not.toHaveProperty("unit_cost");
    expect(result.data?.lines[0]).not.toHaveProperty("batch_id");

    const tablesTouched = supabaseMock.from.mock.calls.map((call) => call[0]);
    expect(tablesTouched).toEqual(["sale_details_view"]);
    expect(tablesTouched).not.toContain("sales");
    expect(tablesTouched).not.toContain("sale_lines");
    expect(tablesTouched).not.toContain("finished_goods_batch_consumptions");
    expect(tablesTouched).not.toContain("production_batches");
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
    expect(supabaseMock.rpc).not.toHaveBeenCalledWith(
      "confirm_sale",
      expect.anything(),
    );
    expect(supabaseMock.rpc).not.toHaveBeenCalledWith(
      "allocate_finished_goods_fifo",
      expect.anything(),
    );
    expect(insertMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });
});

describe("salesReadService.listQueuedSales", () => {
  function queueSaleRow(overrides?: Record<string, unknown>) {
    return {
      id: SALE_ID,
      sale_number: "S-1001",
      confirmed_at: "2026-08-20T08:00:00.000Z",
      total: "28.50",
      fulfilled_at: null,
      is_paid: false,
      kitchen_note: null,
      ...overrides,
    };
  }

  function queueLineRow(overrides?: Record<string, unknown>) {
    return {
      sale_id: SALE_ID,
      product_id: PRODUCT_ID,
      quantity: "3",
      ...overrides,
    };
  }

  function mockQueueTables(
    sales: ReturnType<typeof queueSaleRow>[],
    lines: ReturnType<typeof queueLineRow>[],
    salesError: unknown = null,
    linesError: unknown = null,
  ) {
    const salesOrderSecond = vi.fn().mockResolvedValue({
      data: salesError ? null : sales,
      error: salesError,
    });
    const salesOrderFirst = vi.fn().mockReturnValue({
      order: salesOrderSecond,
    });
    const salesIs = vi.fn().mockReturnValue({
      order: salesOrderFirst,
    });
    const salesIn = vi.fn().mockReturnValue({
      is: salesIs,
    });
    const salesSelect = vi.fn().mockReturnValue({
      in: salesIn,
    });

    const linesOrderSecond = vi.fn().mockResolvedValue({
      data: linesError ? null : lines,
      error: linesError,
    });
    const linesOrderFirst = vi.fn().mockReturnValue({
      order: linesOrderSecond,
    });
    const linesIn = vi.fn().mockReturnValue({
      order: linesOrderFirst,
    });
    const linesSelect = vi.fn().mockReturnValue({
      in: linesIn,
    });

    supabaseMock.from.mockImplementation((table: string) => {
      if (table === "sales") {
        return {
          select: salesSelect,
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

      throw new Error(`Unexpected table: ${table}`);
    });

    return {
      salesSelect,
      salesIn,
      salesIs,
      salesOrderFirst,
      linesSelect,
      linesIn,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    insertMock.mockReset();
    updateMock.mockReset();
    deleteMock.mockReset();
  });

  it("reads sales + sale_lines for confirmed/paid rows with fulfilled_at NULL", async () => {
    const { salesSelect, salesIn, salesIs, linesSelect, linesIn } =
      mockQueueTables([queueSaleRow()], [queueLineRow()]);

    const result = await salesReadService.listQueuedSales();

    expect(result.error).toBeNull();
    expect(result.data).toEqual([
      {
        sale_id: SALE_ID,
        sale_number: "S-1001",
        confirmed_at: "2026-08-20T08:00:00.000Z",
        total: 28.5,
        is_paid: false,
        kitchen_note: null,
        lines: [
          {
            product_id: PRODUCT_ID,
            quantity: 3,
          },
        ],
      },
    ]);
    expect(supabaseMock.from).toHaveBeenCalledWith("sales");
    expect(supabaseMock.from).toHaveBeenCalledWith("sale_lines");
    expect(salesSelect).toHaveBeenCalledWith(
      "id, sale_number, confirmed_at, total, fulfilled_at, is_paid, kitchen_note",
    );
    expect(salesIn).toHaveBeenCalledWith("status", ["confirmed", "paid"]);
    expect(salesIs).toHaveBeenCalledWith("fulfilled_at", null);
    expect(linesSelect).toHaveBeenCalledWith("sale_id, product_id, quantity");
    expect(linesIn).toHaveBeenCalledWith("sale_id", [SALE_ID]);
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it("does not query sale_lines when the queue is empty", async () => {
    mockQueueTables([], []);

    const result = await salesReadService.listQueuedSales();

    expect(result.error).toBeNull();
    expect(result.data).toEqual([]);
    expect(supabaseMock.from).toHaveBeenCalledWith("sales");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("sale_lines");
  });

  it("orders oldest confirmed_at first", async () => {
    const { salesOrderFirst } = mockQueueTables(
      [
        queueSaleRow({
          id: SALE_ID,
          confirmed_at: "2026-08-20T08:00:00.000Z",
        }),
        queueSaleRow({
          id: SALE_ID_2,
          sale_number: "S-1002",
          confirmed_at: "2026-08-20T09:00:00.000Z",
        }),
      ],
      [],
    );

    await salesReadService.listQueuedSales();

    expect(salesOrderFirst).toHaveBeenCalledWith("confirmed_at", {
      ascending: true,
    });
  });
});

describe("salesReadService.getSoldQuantityByProductId", () => {
  const PRODUCT_ID_2 = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  const SOLD_SELECT = "product_id, quantity, sales!inner(status)";

  function soldLineRow(overrides?: Record<string, unknown>) {
    return {
      product_id: PRODUCT_ID,
      quantity: "3",
      sales: { status: "confirmed" },
      ...overrides,
    };
  }

  function mockSoldQtyLines(
    rows: ReturnType<typeof soldLineRow>[],
    error: unknown = null,
  ) {
    const selectMock = vi.fn().mockResolvedValue({
      data: error ? null : rows,
      error,
    });

    supabaseMock.from.mockImplementation((table: string) => {
      if (table === "sale_lines") {
        return {
          select: selectMock,
          insert: insertMock,
          update: updateMock,
          delete: deleteMock,
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    });

    return { selectMock };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    insertMock.mockReset();
    updateMock.mockReset();
    deleteMock.mockReset();
  });

  it("reads sale_lines with an inner sales status embed and no RPC", async () => {
    const { selectMock } = mockSoldQtyLines([soldLineRow()]);

    const result = await salesReadService.getSoldQuantityByProductId();

    expect(result.error).toBeNull();
    expect(supabaseMock.from).toHaveBeenCalledTimes(1);
    expect(supabaseMock.from).toHaveBeenCalledWith("sale_lines");
    expect(selectMock).toHaveBeenCalledWith(SOLD_SELECT);
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("sums quantity for two confirmed lines of the same product", async () => {
    mockSoldQtyLines([
      soldLineRow({ quantity: "3" }),
      soldLineRow({ quantity: "2" }),
    ]);

    const result = await salesReadService.getSoldQuantityByProductId();

    expect(result.error).toBeNull();
    expect(result.data?.get(PRODUCT_ID)).toBe(5);
    expect(result.data?.size).toBe(1);
  });

  it("includes confirmed and paid, excludes draft and cancelled", async () => {
    mockSoldQtyLines([
      soldLineRow({ quantity: "3", sales: { status: "confirmed" } }),
      soldLineRow({ quantity: "2", sales: { status: "paid" } }),
      soldLineRow({ quantity: "10", sales: { status: "draft" } }),
      soldLineRow({
        quantity: "7",
        product_id: PRODUCT_ID_2,
        sales: { status: "cancelled" },
      }),
    ]);

    const result = await salesReadService.getSoldQuantityByProductId();

    expect(result.error).toBeNull();
    expect(result.data?.get(PRODUCT_ID)).toBe(5);
    expect(result.data?.has(PRODUCT_ID_2)).toBe(false);
  });

  it("returns an empty map when there are no lines", async () => {
    mockSoldQtyLines([]);

    const result = await salesReadService.getSoldQuantityByProductId();

    expect(result.error).toBeNull();
    expect(result.data).toEqual(new Map());
  });

  it("fails on an invalid row without returning a partial map", async () => {
    mockSoldQtyLines([
      soldLineRow(),
      soldLineRow({ product_id: null, quantity: "4" }),
    ]);

    const result = await salesReadService.getSoldQuantityByProductId();

    expect(result.data).toBeNull();
    expect(result.error).toBe("Sold quantity response was invalid.");
  });

  it("maps supabase errors", async () => {
    mockSoldQtyLines([], {
      message: "permission denied for table sale_lines",
    });

    const result = await salesReadService.getSoldQuantityByProductId();

    expect(result.data).toBeNull();
    expect(result.error).toBe("permission denied for table sale_lines");
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });
});
