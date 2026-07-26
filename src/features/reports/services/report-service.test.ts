/**
 * Service-level coverage for reportService (DEV-041).
 *
 * Reads must go only through report_*_summary views.
 * The service must not query base tables, call RPCs, recalculate totals,
 * mutate stock, or implement FIFO.
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

import { reportService } from "./report-service";
import type {
  FinishedGoodsSummaryRow,
  InventorySummaryRow,
  PurchaseSummaryRow,
  SalesSummaryRow,
} from "../types/report";

const INGREDIENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PRODUCT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SALE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PURCHASE_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const SUPPLIER_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const insertMock = vi.fn();
const updateMock = vi.fn();
const deleteMock = vi.fn();

const INVENTORY_SELECT =
  "ingredient_id, ingredient_name, unit, category_id, supplier_id, current_stock, minimum_stock, cost_per_unit, stock_value, is_below_minimum";

const FINISHED_GOODS_SELECT =
  "product_id, product_name, available_quantity, active_batch_count, average_unit_cost, inventory_value, oldest_batch_at, newest_batch_at, production_status";

const SALES_SELECT =
  "sale_id, sale_number, status, sale_date, customer_id, subtotal, tax_total, total, confirmed_at, paid_at, cancelled_at";

const PURCHASE_SELECT =
  "purchase_id, supplier_id, status, invoice_number, subtotal, tax_total, total, currency, purchased_at, created_at, updated_at";

const REPORT_VIEWS = new Set([
  "report_inventory_summary",
  "report_finished_goods_summary",
  "report_sales_summary",
  "report_purchase_summary",
]);

function forbidBaseTables(table: string) {
  if (
    table === "ingredients" ||
    table === "purchases" ||
    table === "purchase_items" ||
    table === "sales" ||
    table === "sale_lines" ||
    table === "sales_list_view" ||
    table === "finished_goods_batch_consumptions" ||
    table === "production_batches" ||
    table === "finished_goods_batch_availability" ||
    table === "recipes"
  ) {
    throw new Error(`Base table queried: ${table}`);
  }
}

function inventoryRow(overrides?: Record<string, unknown>) {
  return {
    ingredient_id: INGREDIENT_ID,
    ingredient_name: "Flour",
    unit: "kg",
    category_id: null,
    supplier_id: SUPPLIER_ID,
    current_stock: "10",
    minimum_stock: "5",
    cost_per_unit: "2.5",
    stock_value: "25",
    is_below_minimum: false,
    ...overrides,
  };
}

function finishedGoodsRow(overrides?: Record<string, unknown>) {
  return {
    product_id: PRODUCT_ID,
    product_name: "Chicken Crepe",
    available_quantity: "12",
    active_batch_count: "2",
    average_unit_cost: "2.5",
    inventory_value: "30",
    oldest_batch_at: "2026-07-01T10:00:00.000Z",
    newest_batch_at: "2026-07-20T10:00:00.000Z",
    production_status: "available",
    ...overrides,
  };
}

function salesRow(overrides?: Record<string, unknown>) {
  return {
    sale_id: SALE_ID,
    sale_number: "S-000001",
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

function purchaseRow(overrides?: Record<string, unknown>) {
  return {
    purchase_id: PURCHASE_ID,
    supplier_id: SUPPLIER_ID,
    status: "received",
    invoice_number: "INV-1",
    subtotal: "100",
    tax_total: "0",
    total: "100",
    currency: "EUR",
    purchased_at: "2026-07-21T12:00:00.000Z",
    created_at: "2026-07-21T12:00:00.000Z",
    updated_at: "2026-07-21T12:30:00.000Z",
    ...overrides,
  };
}

function mockSummaryView(
  viewName: string,
  rows: Record<string, unknown>[],
  error: unknown = null,
) {
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

    if (table === viewName) {
      return {
        select: selectMock,
        insert: insertMock,
        update: updateMock,
        delete: deleteMock,
      };
    }

    if (REPORT_VIEWS.has(table)) {
      throw new Error(`Unexpected report view: ${table}`);
    }

    throw new Error(`Unexpected table: ${table}`);
  });

  return { selectMock, orderFirst, orderSecond };
}

function expectReadOnly(tablesTouched: string[]) {
  expect(tablesTouched.every((table) => REPORT_VIEWS.has(table))).toBe(true);
  expect(tablesTouched).not.toContain("ingredients");
  expect(tablesTouched).not.toContain("purchases");
  expect(tablesTouched).not.toContain("sales");
  expect(tablesTouched).not.toContain("sale_lines");
  expect(tablesTouched).not.toContain("finished_goods_batch_consumptions");
  expect(tablesTouched).not.toContain("production_batches");
  expect(tablesTouched).not.toContain("finished_goods_batch_availability");
  expect(supabaseMock.rpc).not.toHaveBeenCalled();
  expect(insertMock).not.toHaveBeenCalled();
  expect(updateMock).not.toHaveBeenCalled();
  expect(deleteMock).not.toHaveBeenCalled();
}

describe("reportService (DEV-041)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertMock.mockReset();
    updateMock.mockReset();
    deleteMock.mockReset();
  });

  describe("getInventorySummary", () => {
    it("queries only report_inventory_summary and returns typed rows", async () => {
      const { selectMock, orderFirst, orderSecond } = mockSummaryView(
        "report_inventory_summary",
        [inventoryRow()],
      );

      const result = await reportService.getInventorySummary();

      expect(result.error).toBeNull();
      expect(result.data).toEqual([
        {
          ingredient_id: INGREDIENT_ID,
          ingredient_name: "Flour",
          unit: "kg",
          category_id: null,
          supplier_id: SUPPLIER_ID,
          current_stock: 10,
          minimum_stock: 5,
          cost_per_unit: 2.5,
          stock_value: 25,
          is_below_minimum: false,
        },
      ] satisfies InventorySummaryRow[]);
      expect(supabaseMock.from).toHaveBeenCalledWith("report_inventory_summary");
      expect(selectMock).toHaveBeenCalledWith(INVENTORY_SELECT);
      expect(orderFirst).toHaveBeenCalledWith("ingredient_name", {
        ascending: true,
      });
      expect(orderSecond).toHaveBeenCalledWith("ingredient_id", {
        ascending: true,
      });
      expectReadOnly(
        supabaseMock.from.mock.calls.map((call) => call[0] as string),
      );
    });

    it("returns an empty array when the view has no rows", async () => {
      mockSummaryView("report_inventory_summary", []);

      const result = await reportService.getInventorySummary();

      expect(result.error).toBeNull();
      expect(result.data).toEqual([]);
    });

    it("maps missing-view errors", async () => {
      mockSummaryView("report_inventory_summary", [], {
        message: 'relation "report_inventory_summary" does not exist',
        code: "42P01",
      });

      const result = await reportService.getInventorySummary();

      expect(result.data).toBeNull();
      expect(result.error).toBe(
        "Reporting views are not available yet. Apply the reporting foundation database script and try again.",
      );
      expect(supabaseMock.rpc).not.toHaveBeenCalled();
    });

    it("does not recalculate stock_value from TypeScript", async () => {
      mockSummaryView("report_inventory_summary", [
        inventoryRow({
          current_stock: "10",
          cost_per_unit: "2",
          // Intentionally inconsistent with current_stock * cost_per_unit
          stock_value: "999",
        }),
      ]);

      const result = await reportService.getInventorySummary();

      expect(result.error).toBeNull();
      expect(result.data?.[0]?.stock_value).toBe(999);
      expect(result.data?.[0]?.stock_value).not.toBe(20);
    });
  });

  describe("getFinishedGoodsSummary", () => {
    it("queries only report_finished_goods_summary and returns typed rows", async () => {
      const { selectMock, orderFirst, orderSecond } = mockSummaryView(
        "report_finished_goods_summary",
        [finishedGoodsRow()],
      );

      const result = await reportService.getFinishedGoodsSummary();

      expect(result.error).toBeNull();
      expect(result.data).toEqual([
        {
          product_id: PRODUCT_ID,
          product_name: "Chicken Crepe",
          available_quantity: 12,
          active_batch_count: 2,
          average_unit_cost: 2.5,
          inventory_value: 30,
          oldest_batch_at: "2026-07-01T10:00:00.000Z",
          newest_batch_at: "2026-07-20T10:00:00.000Z",
          production_status: "available",
        },
      ] satisfies FinishedGoodsSummaryRow[]);
      expect(supabaseMock.from).toHaveBeenCalledWith(
        "report_finished_goods_summary",
      );
      expect(selectMock).toHaveBeenCalledWith(FINISHED_GOODS_SELECT);
      expect(orderFirst).toHaveBeenCalledWith("product_name", {
        ascending: true,
      });
      expect(orderSecond).toHaveBeenCalledWith("product_id", {
        ascending: true,
      });
      expectReadOnly(
        supabaseMock.from.mock.calls.map((call) => call[0] as string),
      );
    });

    it("returns an empty array when the view has no rows", async () => {
      mockSummaryView("report_finished_goods_summary", []);

      const result = await reportService.getFinishedGoodsSummary();

      expect(result.error).toBeNull();
      expect(result.data).toEqual([]);
    });

    it("maps missing-view errors", async () => {
      mockSummaryView("report_finished_goods_summary", [], {
        message: 'relation "report_finished_goods_summary" does not exist',
        code: "42P01",
      });

      const result = await reportService.getFinishedGoodsSummary();

      expect(result.data).toBeNull();
      expect(result.error).toBe(
        "Reporting views are not available yet. Apply the reporting foundation database script and try again.",
      );
    });

    it("does not recalculate available_quantity or inventory_value", async () => {
      mockSummaryView("report_finished_goods_summary", [
        finishedGoodsRow({
          available_quantity: "0",
          active_batch_count: "0",
          average_unit_cost: null,
          inventory_value: null,
          oldest_batch_at: null,
          newest_batch_at: null,
          production_status: "out_of_stock",
        }),
      ]);

      const result = await reportService.getFinishedGoodsSummary();

      expect(result.error).toBeNull();
      expect(result.data?.[0]).toEqual({
        product_id: PRODUCT_ID,
        product_name: "Chicken Crepe",
        available_quantity: 0,
        active_batch_count: 0,
        average_unit_cost: null,
        inventory_value: null,
        oldest_batch_at: null,
        newest_batch_at: null,
        production_status: "out_of_stock",
      } satisfies FinishedGoodsSummaryRow);
    });
  });

  describe("getSalesSummary", () => {
    it("queries only report_sales_summary and returns typed rows", async () => {
      const { selectMock, orderFirst, orderSecond } = mockSummaryView(
        "report_sales_summary",
        [salesRow()],
      );

      const result = await reportService.getSalesSummary();

      expect(result.error).toBeNull();
      expect(result.data).toEqual([
        {
          sale_id: SALE_ID,
          sale_number: "S-000001",
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
      ] satisfies SalesSummaryRow[]);
      expect(supabaseMock.from).toHaveBeenCalledWith("report_sales_summary");
      expect(selectMock).toHaveBeenCalledWith(SALES_SELECT);
      expect(orderFirst).toHaveBeenCalledWith("sale_date", {
        ascending: false,
      });
      expect(orderSecond).toHaveBeenCalledWith("sale_id", { ascending: true });
      expectReadOnly(
        supabaseMock.from.mock.calls.map((call) => call[0] as string),
      );
    });

    it("returns an empty array when the view has no rows", async () => {
      mockSummaryView("report_sales_summary", []);

      const result = await reportService.getSalesSummary();

      expect(result.error).toBeNull();
      expect(result.data).toEqual([]);
    });

    it("maps missing-view errors", async () => {
      mockSummaryView("report_sales_summary", [], {
        message: 'relation "report_sales_summary" does not exist',
        code: "42P01",
      });

      const result = await reportService.getSalesSummary();

      expect(result.data).toBeNull();
      expect(result.error).toBe(
        "Reporting views are not available yet. Apply the reporting foundation database script and try again.",
      );
    });

    it("does not recalculate totals from TypeScript", async () => {
      mockSummaryView("report_sales_summary", [
        salesRow({
          subtotal: "10",
          tax_total: "1",
          total: "777",
        }),
      ]);

      const result = await reportService.getSalesSummary();

      expect(result.error).toBeNull();
      expect(result.data?.[0]?.total).toBe(777);
      expect(result.data?.[0]?.subtotal).toBe(10);
      expect(result.data?.[0]?.tax_total).toBe(1);
    });
  });

  describe("getPurchaseSummary", () => {
    it("queries only report_purchase_summary and returns typed rows", async () => {
      const { selectMock, orderFirst, orderSecond } = mockSummaryView(
        "report_purchase_summary",
        [purchaseRow()],
      );

      const result = await reportService.getPurchaseSummary();

      expect(result.error).toBeNull();
      expect(result.data).toEqual([
        {
          purchase_id: PURCHASE_ID,
          supplier_id: SUPPLIER_ID,
          status: "received",
          invoice_number: "INV-1",
          subtotal: 100,
          tax_total: 0,
          total: 100,
          currency: "EUR",
          purchased_at: "2026-07-21T12:00:00.000Z",
          created_at: "2026-07-21T12:00:00.000Z",
          updated_at: "2026-07-21T12:30:00.000Z",
        },
      ] satisfies PurchaseSummaryRow[]);
      expect(supabaseMock.from).toHaveBeenCalledWith("report_purchase_summary");
      expect(selectMock).toHaveBeenCalledWith(PURCHASE_SELECT);
      expect(orderFirst).toHaveBeenCalledWith("purchased_at", {
        ascending: false,
      });
      expect(orderSecond).toHaveBeenCalledWith("purchase_id", {
        ascending: true,
      });
      expectReadOnly(
        supabaseMock.from.mock.calls.map((call) => call[0] as string),
      );
    });

    it("returns an empty array when the view has no rows", async () => {
      mockSummaryView("report_purchase_summary", []);

      const result = await reportService.getPurchaseSummary();

      expect(result.error).toBeNull();
      expect(result.data).toEqual([]);
    });

    it("maps missing-view errors", async () => {
      mockSummaryView("report_purchase_summary", [], {
        message: 'relation "report_purchase_summary" does not exist',
        code: "42P01",
      });

      const result = await reportService.getPurchaseSummary();

      expect(result.data).toBeNull();
      expect(result.error).toBe(
        "Reporting views are not available yet. Apply the reporting foundation database script and try again.",
      );
    });
  });

  it("never mutates data across summary reads", async () => {
    mockSummaryView("report_inventory_summary", [inventoryRow()]);
    await reportService.getInventorySummary();

    mockSummaryView("report_finished_goods_summary", [finishedGoodsRow()]);
    await reportService.getFinishedGoodsSummary();

    mockSummaryView("report_sales_summary", [salesRow()]);
    await reportService.getSalesSummary();

    mockSummaryView("report_purchase_summary", [purchaseRow()]);
    await reportService.getPurchaseSummary();

    expect(supabaseMock.rpc).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();

    const tablesTouched = supabaseMock.from.mock.calls.map(
      (call) => call[0] as string,
    );
    expect(new Set(tablesTouched)).toEqual(REPORT_VIEWS);
  });
});
