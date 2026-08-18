import { describe, expect, it } from "vitest";
import type { PurchaseWithRelations } from "../types/purchase";
import { purchaseToFormValues } from "./map-purchase-form-values";

function purchase(
  overrides?: Partial<PurchaseWithRelations>,
): PurchaseWithRelations {
  return {
    id: "purchase-1",
    supplier_id: "supplier-1",
    status: "received",
    invoice_number: "INV-1",
    notes: null,
    subtotal: 100,
    tax_total: 21,
    total: 121,
    currency: "EUR",
    purchased_at: "2026-08-18T12:00:00.000Z",
    transaction_id: null,
    production_plan_id: null,
    created_at: "2026-08-18T12:00:00.000Z",
    supplier: { id: "supplier-1", name: "Dairy Co" },
    items: [
      {
        id: "item-1",
        purchase_id: "purchase-1",
        ingredient_id: "ing-1",
        quantity: 1,
        unit_cost: 100,
        line_total: 100,
        tax_category: null,
        tax_regime: null,
        price_mode: null,
        entered_unit_price: null,
        ingredient: { id: "ing-1", name: "Milk", unit: "L" },
      },
    ],
    ...overrides,
  };
}

describe("purchaseToFormValues", () => {
  it("does not substitute goods/standard_vat for unrecorded historical tax fields", () => {
    const values = purchaseToFormValues(purchase());

    expect(values.lines[0]).toMatchObject({
      unit_cost: 100,
      tax_category: null,
      tax_regime: null,
      price_mode: null,
      entered_unit_price: null,
    });
  });

  it("shows the typed entered_unit_price in the unit price field when present", () => {
    const values = purchaseToFormValues(
      purchase({
        items: [
          {
            id: "item-1",
            purchase_id: "purchase-1",
            ingredient_id: "ing-1",
            quantity: 1,
            unit_cost: 100,
            line_total: 100,
            tax_category: "food",
            tax_regime: "reduced_vat",
            price_mode: "inclusive",
            entered_unit_price: 121,
            ingredient: { id: "ing-1", name: "Milk", unit: "L" },
          },
        ],
      }),
    );

    expect(values.lines[0]).toMatchObject({
      unit_cost: 121,
      tax_category: "food",
      tax_regime: "reduced_vat",
      price_mode: "inclusive",
      entered_unit_price: 121,
    });
  });
});
