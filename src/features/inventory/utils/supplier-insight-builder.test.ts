/**
 * Pure builder coverage for Supplier Insights (DEV-119).
 */

import { describe, expect, it } from "vitest";
import type {
  SupplierInsight,
  SupplierInsightPurchaseFact,
} from "../types/supplier-insight";
import {
  assertSupplierInsightHistoricallyConsistent,
  buildSupplierInsight,
} from "./supplier-insight-builder";

const INGREDIENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SUPPLIER_A = "11111111-1111-4111-8111-111111111111";
const SUPPLIER_B = "22222222-2222-4222-8222-222222222222";

function fact(
  overrides?: Partial<SupplierInsightPurchaseFact>,
): SupplierInsightPurchaseFact {
  return {
    ingredient_id: INGREDIENT_ID,
    supplier_id: SUPPLIER_A,
    supplier_name: "Alpha Foods",
    purchased_at: "2026-07-20T10:00:00.000Z",
    unit_price: 2.5,
    ...overrides,
  };
}

describe("supplier-insight-builder (DEV-119)", () => {
  it("returns empty insight when there is no purchase history", () => {
    const result = buildSupplierInsight({
      ingredient_id: INGREDIENT_ID,
      purchases: [],
    });

    expect(result.error).toBeNull();
    expect(result.data).toEqual({
      ingredient_id: INGREDIENT_ID,
      last_supplier_id: null,
      last_supplier_name: null,
      last_purchase_date: null,
      last_purchase_price: null,
      most_frequent_supplier_id: null,
      most_frequent_supplier_name: null,
      purchase_count: 0,
    });
  });

  it("aggregates a single supplier history", () => {
    const result = buildSupplierInsight({
      ingredient_id: INGREDIENT_ID,
      purchases: [
        fact({
          purchased_at: "2026-07-10T10:00:00.000Z",
          unit_price: 2.0,
        }),
        fact({
          purchased_at: "2026-07-20T10:00:00.000Z",
          unit_price: 2.4,
        }),
      ],
    });

    expect(result.error).toBeNull();
    expect(result.data?.last_supplier_id).toBe(SUPPLIER_A);
    expect(result.data?.last_supplier_name).toBe("Alpha Foods");
    expect(result.data?.last_purchase_date).toBe("2026-07-20T10:00:00.000Z");
    expect(result.data?.last_purchase_price).toBe(2.4);
    expect(result.data?.most_frequent_supplier_id).toBe(SUPPLIER_A);
    expect(result.data?.most_frequent_supplier_name).toBe("Alpha Foods");
    expect(result.data?.purchase_count).toBe(2);
  });

  it("selects the most frequent supplier across multiple suppliers", () => {
    const result = buildSupplierInsight({
      ingredient_id: INGREDIENT_ID,
      purchases: [
        fact({
          supplier_id: SUPPLIER_A,
          supplier_name: "Alpha Foods",
          purchased_at: "2026-07-01T10:00:00.000Z",
          unit_price: 2.0,
        }),
        fact({
          supplier_id: SUPPLIER_B,
          supplier_name: "Beta Supply",
          purchased_at: "2026-07-05T10:00:00.000Z",
          unit_price: 2.1,
        }),
        fact({
          supplier_id: SUPPLIER_A,
          supplier_name: "Alpha Foods",
          purchased_at: "2026-07-10T10:00:00.000Z",
          unit_price: 2.2,
        }),
        fact({
          supplier_id: SUPPLIER_B,
          supplier_name: "Beta Supply",
          purchased_at: "2026-07-25T10:00:00.000Z",
          unit_price: 2.5,
        }),
        fact({
          supplier_id: SUPPLIER_A,
          supplier_name: "Alpha Foods",
          purchased_at: "2026-07-15T10:00:00.000Z",
          unit_price: 2.3,
        }),
      ],
    });

    expect(result.error).toBeNull();
    // Last purchase is Beta on Jul 25
    expect(result.data?.last_supplier_id).toBe(SUPPLIER_B);
    expect(result.data?.last_supplier_name).toBe("Beta Supply");
    expect(result.data?.last_purchase_date).toBe("2026-07-25T10:00:00.000Z");
    expect(result.data?.last_purchase_price).toBe(2.5);
    // Alpha appears 3 times, Beta 2
    expect(result.data?.most_frequent_supplier_id).toBe(SUPPLIER_A);
    expect(result.data?.most_frequent_supplier_name).toBe("Alpha Foods");
    expect(result.data?.purchase_count).toBe(5);
  });

  it("uses the most recent purchase for last supplier/price/date", () => {
    const result = buildSupplierInsight({
      ingredient_id: INGREDIENT_ID,
      purchases: [
        fact({
          supplier_id: SUPPLIER_A,
          supplier_name: "Alpha Foods",
          purchased_at: "2026-06-01T10:00:00.000Z",
          unit_price: 1.5,
        }),
        fact({
          supplier_id: SUPPLIER_B,
          supplier_name: "Beta Supply",
          purchased_at: "2026-07-26T12:00:00.000Z",
          unit_price: 3.75,
        }),
      ],
    });

    expect(result.error).toBeNull();
    expect(result.data?.last_supplier_id).toBe(SUPPLIER_B);
    expect(result.data?.last_purchase_date).toBe("2026-07-26T12:00:00.000Z");
    expect(result.data?.last_purchase_price).toBe(3.75);
  });

  it("allows missing supplier on historical lines", () => {
    const result = buildSupplierInsight({
      ingredient_id: INGREDIENT_ID,
      purchases: [
        fact({
          supplier_id: null,
          supplier_name: null,
          purchased_at: "2026-07-20T10:00:00.000Z",
          unit_price: 2.0,
        }),
        fact({
          supplier_id: SUPPLIER_A,
          supplier_name: "Alpha Foods",
          purchased_at: "2026-07-10T10:00:00.000Z",
          unit_price: 1.8,
        }),
      ],
    });

    expect(result.error).toBeNull();
    expect(result.data?.last_supplier_id).toBeNull();
    expect(result.data?.last_supplier_name).toBeNull();
    expect(result.data?.last_purchase_price).toBe(2.0);
    expect(result.data?.most_frequent_supplier_id).toBe(SUPPLIER_A);
    expect(result.data?.purchase_count).toBe(2);
  });

  it("breaks frequency ties toward the more recent supplier", () => {
    const result = buildSupplierInsight({
      ingredient_id: INGREDIENT_ID,
      purchases: [
        fact({
          supplier_id: SUPPLIER_A,
          supplier_name: "Alpha Foods",
          purchased_at: "2026-07-01T10:00:00.000Z",
          unit_price: 2.0,
        }),
        fact({
          supplier_id: SUPPLIER_B,
          supplier_name: "Beta Supply",
          purchased_at: "2026-07-20T10:00:00.000Z",
          unit_price: 2.2,
        }),
      ],
    });

    expect(result.error).toBeNull();
    expect(result.data?.most_frequent_supplier_id).toBe(SUPPLIER_B);
    expect(result.data?.most_frequent_supplier_name).toBe("Beta Supply");
  });

  it("asserts historical consistency for identical purchase history", () => {
    const purchases = [
      fact({ purchased_at: "2026-07-10T10:00:00.000Z", unit_price: 2.0 }),
      fact({
        supplier_id: SUPPLIER_B,
        supplier_name: "Beta Supply",
        purchased_at: "2026-07-20T10:00:00.000Z",
        unit_price: 2.5,
      }),
    ];

    const first = buildSupplierInsight({
      ingredient_id: INGREDIENT_ID,
      purchases,
    });
    const second = buildSupplierInsight({
      ingredient_id: INGREDIENT_ID,
      purchases: [...purchases].reverse(),
    });

    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    expect(
      assertSupplierInsightHistoricallyConsistent({
        previous: first.data as SupplierInsight,
        next: second.data as SupplierInsight,
      }),
    ).toBeNull();
  });

  it("rejects mismatched ingredient ids on purchase facts", () => {
    const result = buildSupplierInsight({
      ingredient_id: INGREDIENT_ID,
      purchases: [
        fact({
          ingredient_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        }),
      ],
    });

    expect(result.data).toBeNull();
    expect(result.error).toMatch(/ingredient/i);
  });
});
