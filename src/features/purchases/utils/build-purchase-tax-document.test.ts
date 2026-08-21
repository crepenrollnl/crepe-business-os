import { describe, expect, it } from "vitest";
import type { PurchaseFormValues } from "../types/purchase";
import { buildPurchaseTaxDocument } from "./build-purchase-tax-document";

const suppliers = [{ id: "supplier-1", name: "Dairy Co" }];

function values(
  overrides?: Partial<PurchaseFormValues>,
): PurchaseFormValues {
  return {
    supplier_id: "supplier-1",
    invoice_number: "INV-1",
    purchased_at: "2026-08-18",
    notes: "",
    supplier_country: "NL",
    tax_country: "NL",
    lines: [
      {
        ingredient_id: "ing-1",
        quantity: 2,
        unit_cost: 121,
        discount: 0,
        tax_category: "goods",
        tax_regime: "standard_vat",
        price_mode: "exclusive",
      },
    ],
    ...overrides,
  };
}

describe("buildPurchaseTaxDocument", () => {
  it("forwards inclusive price_mode and the typed unit price", () => {
    const document = buildPurchaseTaxDocument({
      values: values({
        lines: [
          {
            ingredient_id: "ing-1",
            quantity: 2,
            unit_cost: 121,
            tax_category: "food",
            tax_regime: "reduced_vat",
            price_mode: "inclusive",
          },
        ],
      }),
      suppliers,
    });

    expect(document.lines[0]).toMatchObject({
      line_id: "line-1",
      quantity: 2,
      unit_price: 121,
      price_mode: "inclusive",
      tax_category: "food",
      tax_regime: "reduced_vat",
    });
  });

  it("omits incomplete lines instead of sending blank tax fields", () => {
    const document = buildPurchaseTaxDocument({
      values: values({
        lines: [
          {
            ingredient_id: "ing-1",
            quantity: 1,
            unit_cost: 10,
            tax_category: "",
            tax_regime: "",
            price_mode: null,
          },
        ],
      }),
      suppliers,
    });

    expect(document.lines).toEqual([]);
  });

  it("keeps original line_id after skipping an incomplete row", () => {
    const document = buildPurchaseTaxDocument({
      values: values({
        lines: [
          {
            ingredient_id: "ing-1",
            quantity: 0,
            unit_cost: 0,
            tax_category: "",
            tax_regime: "",
            price_mode: null,
          },
          {
            ingredient_id: "ing-2",
            quantity: 6,
            unit_cost: 0.98,
            tax_category: "food",
            tax_regime: "reduced_vat",
            price_mode: "inclusive",
          },
        ],
      }),
      suppliers,
    });

    expect(document.lines).toHaveLength(1);
    expect(document.lines[0]).toMatchObject({
      line_id: "line-2",
      quantity: 6,
      unit_price: 0.98,
      price_mode: "inclusive",
      tax_category: "food",
    });
  });
});
