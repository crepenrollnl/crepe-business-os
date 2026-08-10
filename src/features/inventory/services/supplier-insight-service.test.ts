/**
 * Service-level coverage for supplierInsightService (DEV-119).
 *
 * Read-only: purchase_items + received purchases. No mutations.
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

import { supplierInsightService } from "./supplier-insight-service";

const FLOUR_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MILK_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SUPPLIER_A = "11111111-1111-4111-8111-111111111111";
const SUPPLIER_B = "22222222-2222-4222-8222-222222222222";

const insertMock = vi.fn();
const updateMock = vi.fn();
const deleteMock = vi.fn();

function mockPurchaseItems(rows: Record<string, unknown>[]) {
  const eq = vi.fn().mockResolvedValue({ data: rows, error: null });
  const select = vi.fn().mockReturnValue({ eq });
  return { select, eq };
}

describe("supplierInsightService (DEV-119)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertMock.mockReset();
    updateMock.mockReset();
    deleteMock.mockReset();
  });

  it("returns empty insights when there is no purchase history", async () => {
    const purchaseItems = mockPurchaseItems([]);

    supabaseMock.from.mockImplementation((table: string) => {
      expect(table).toBe("purchase_items");
      return {
        select: purchaseItems.select,
        insert: insertMock,
        update: updateMock,
        delete: deleteMock,
      };
    });

    const result = await supplierInsightService.getSupplierInsightMap([
      FLOUR_ID,
    ]);

    expect(result.error).toBeNull();
    expect(result.data?.get(FLOUR_ID)).toEqual({
      ingredient_id: FLOUR_ID,
      last_supplier_id: null,
      last_supplier_name: null,
      last_purchase_date: null,
      last_purchase_price: null,
      most_frequent_supplier_id: null,
      most_frequent_supplier_name: null,
      purchase_count: 0,
    });
    expect(insertMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("aggregates a single supplier for an ingredient", async () => {
    const purchaseItems = mockPurchaseItems([
      {
        ingredient_id: FLOUR_ID,
        unit_cost: 2.0,
        purchases: {
          id: "purchase-1",
          supplier_id: SUPPLIER_A,
          purchased_at: "2026-07-10T10:00:00.000Z",
          status: "received",
          suppliers: { id: SUPPLIER_A, name: "Alpha Foods" },
        },
      },
      {
        ingredient_id: FLOUR_ID,
        unit_cost: 2.4,
        purchases: {
          id: "purchase-2",
          supplier_id: SUPPLIER_A,
          purchased_at: "2026-07-20T10:00:00.000Z",
          status: "received",
          suppliers: { id: SUPPLIER_A, name: "Alpha Foods" },
        },
      },
    ]);

    supabaseMock.from.mockImplementation(() => ({
      select: purchaseItems.select,
      insert: insertMock,
      update: updateMock,
      delete: deleteMock,
    }));

    const result = await supplierInsightService.getSupplierInsights();

    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(1);
    expect(result.data?.[0]).toMatchObject({
      ingredient_id: FLOUR_ID,
      last_supplier_id: SUPPLIER_A,
      last_supplier_name: "Alpha Foods",
      last_purchase_date: "2026-07-20T10:00:00.000Z",
      last_purchase_price: 2.4,
      most_frequent_supplier_id: SUPPLIER_A,
      purchase_count: 2,
    });
    expect(purchaseItems.eq).toHaveBeenCalledWith(
      "purchases.status",
      "received",
    );
  });

  it("handles multiple suppliers and last purchase correctly", async () => {
    const purchaseItems = mockPurchaseItems([
      {
        ingredient_id: FLOUR_ID,
        unit_cost: 2.0,
        purchases: {
          id: "purchase-1",
          supplier_id: SUPPLIER_A,
          purchased_at: "2026-07-01T10:00:00.000Z",
          status: "received",
          suppliers: { id: SUPPLIER_A, name: "Alpha Foods" },
        },
      },
      {
        ingredient_id: FLOUR_ID,
        unit_cost: 2.1,
        purchases: {
          id: "purchase-2",
          supplier_id: SUPPLIER_B,
          purchased_at: "2026-07-05T10:00:00.000Z",
          status: "received",
          suppliers: { id: SUPPLIER_B, name: "Beta Supply" },
        },
      },
      {
        ingredient_id: FLOUR_ID,
        unit_cost: 2.2,
        purchases: {
          id: "purchase-3",
          supplier_id: SUPPLIER_A,
          purchased_at: "2026-07-10T10:00:00.000Z",
          status: "received",
          suppliers: { id: SUPPLIER_A, name: "Alpha Foods" },
        },
      },
      {
        ingredient_id: FLOUR_ID,
        unit_cost: 2.5,
        purchases: {
          id: "purchase-4",
          supplier_id: SUPPLIER_B,
          purchased_at: "2026-07-25T10:00:00.000Z",
          status: "received",
          suppliers: { id: SUPPLIER_B, name: "Beta Supply" },
        },
      },
      {
        ingredient_id: FLOUR_ID,
        unit_cost: 2.3,
        purchases: {
          id: "purchase-5",
          supplier_id: SUPPLIER_A,
          purchased_at: "2026-07-15T10:00:00.000Z",
          status: "received",
          suppliers: { id: SUPPLIER_A, name: "Alpha Foods" },
        },
      },
    ]);

    supabaseMock.from.mockImplementation(() => ({
      select: purchaseItems.select,
      insert: insertMock,
      update: updateMock,
      delete: deleteMock,
    }));

    const result = await supplierInsightService.getSupplierInsights();

    expect(result.error).toBeNull();
    const flour = result.data?.[0];
    expect(flour?.last_supplier_id).toBe(SUPPLIER_B);
    expect(flour?.last_purchase_price).toBe(2.5);
    expect(flour?.last_purchase_date).toBe("2026-07-25T10:00:00.000Z");
    expect(flour?.most_frequent_supplier_id).toBe(SUPPLIER_A);
    expect(flour?.purchase_count).toBe(5);
  });

  it("allows missing supplier on received purchase lines", async () => {
    const purchaseItems = mockPurchaseItems([
      {
        ingredient_id: FLOUR_ID,
        unit_cost: 2.0,
        purchases: {
          id: "purchase-1",
          supplier_id: null,
          purchased_at: "2026-07-20T10:00:00.000Z",
          status: "received",
          suppliers: null,
        },
      },
    ]);

    supabaseMock.from.mockImplementation(() => ({
      select: purchaseItems.select,
      insert: insertMock,
      update: updateMock,
      delete: deleteMock,
    }));

    const result = await supplierInsightService.getSupplierInsights();

    expect(result.error).toBeNull();
    expect(result.data?.[0]).toMatchObject({
      ingredient_id: FLOUR_ID,
      last_supplier_id: null,
      last_supplier_name: null,
      last_purchase_price: 2.0,
      most_frequent_supplier_id: null,
      purchase_count: 1,
    });
  });

  it("is historically consistent for the same purchase rows", async () => {
    const rows = [
      {
        ingredient_id: FLOUR_ID,
        unit_cost: 2.0,
        purchases: {
          id: "purchase-1",
          supplier_id: SUPPLIER_A,
          purchased_at: "2026-07-10T10:00:00.000Z",
          status: "received",
          suppliers: { id: SUPPLIER_A, name: "Alpha Foods" },
        },
      },
      {
        ingredient_id: MILK_ID,
        unit_cost: 1.5,
        purchases: {
          id: "purchase-2",
          supplier_id: SUPPLIER_B,
          purchased_at: "2026-07-12T10:00:00.000Z",
          status: "received",
          suppliers: { id: SUPPLIER_B, name: "Beta Supply" },
        },
      },
    ];

    const firstQuery = mockPurchaseItems(rows);
    const secondQuery = mockPurchaseItems([...rows].reverse());

    let call = 0;
    supabaseMock.from.mockImplementation(() => {
      call += 1;
      const query = call === 1 ? firstQuery : secondQuery;
      return {
        select: query.select,
        insert: insertMock,
        update: updateMock,
        delete: deleteMock,
      };
    });

    const first = await supplierInsightService.getSupplierInsights();
    const second = await supplierInsightService.getSupplierInsights();

    expect(first.error).toBeNull();
    expect(second.error).toBeNull();

    const firstById = new Map(
      (first.data ?? []).map((insight) => [insight.ingredient_id, insight]),
    );
    const secondById = new Map(
      (second.data ?? []).map((insight) => [insight.ingredient_id, insight]),
    );

    for (const id of [FLOUR_ID, MILK_ID]) {
      const previous = firstById.get(id);
      const next = secondById.get(id);
      expect(previous).toBeDefined();
      expect(next).toBeDefined();
      expect(
        supplierInsightService.assertSupplierInsightHistoricallyConsistent({
          previous: previous!,
          next: next!,
        }),
      ).toBeNull();
    }
  });
});
