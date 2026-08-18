import { describe, expect, it } from "vitest";
import { roundMoney } from "@/lib/money";
import type { PurchaseLineInput } from "../types/purchase";
import type { PurchaseTaxLineView, PurchaseTaxResult } from "../types/purchase-tax";
import { toNetPurchaseLines } from "./to-net-purchase-lines";

/** Mirrors sql/069 calculate_purchase_totals line_total arithmetic. */
function purchaseTotalsLineTotal(
  quantity: number,
  unitCost: number,
  discount: number,
): number {
  return roundMoney(roundMoney(quantity * unitCost) - discount);
}

function taxLine(
  overrides?: Partial<PurchaseTaxLineView>,
): PurchaseTaxLineView {
  return {
    line_id: "line-1",
    tax_code: "NL-VAT-STD-21",
    tax_rate_percent: 21,
    tax_amount: 21,
    taxable_amount: 100,
    net_amount: 100,
    gross_amount: 121,
    ...overrides,
  };
}

function taxResult(
  lines: PurchaseTaxLineView[] = [taxLine()],
): PurchaseTaxResult {
  return {
    document_id: "purchase-1",
    mode: "calculate",
    is_valid: true,
    subtotal: lines.reduce((sum, line) => sum + line.net_amount, 0),
    tax_total: lines.reduce((sum, line) => sum + line.tax_amount, 0),
    grand_total: lines.reduce((sum, line) => sum + line.gross_amount, 0),
    effective_tax_rate: 0.21,
    lines,
    warnings: [],
    tax_result: { currency: "EUR", breakdown: { lines: [] } },
  };
}

function line(overrides?: Partial<PurchaseLineInput>): PurchaseLineInput {
  return {
    ingredient_id: "ing-1",
    quantity: 1,
    unit_cost: 100,
    discount: 0,
    tax_category: "goods",
    tax_regime: "standard_vat",
    price_mode: "exclusive",
    ...overrides,
  };
}

describe("toNetPurchaseLines (variant C)", () => {
  it("keeps exclusive unit_cost as net and remembers the typed amount", () => {
    const result = toNetPurchaseLines(
      [line({ unit_cost: 100, price_mode: "exclusive" })],
      taxResult(),
    );

    expect(result.error).toBeNull();
    expect(result.data?.[0]).toMatchObject({
      unit_cost: 100,
      entered_unit_price: 100,
      price_mode: "exclusive",
    });
  });

  it("converts inclusive typed prices using tax RPC net_amount, not a local formula", () => {
    const result = toNetPurchaseLines(
      [line({ unit_cost: 121, quantity: 1, price_mode: "inclusive" })],
      taxResult([taxLine({ net_amount: 100, tax_amount: 21, gross_amount: 121 })]),
    );

    expect(result.error).toBeNull();
    expect(result.data?.[0]?.unit_cost).toBe(100);
    expect(result.data?.[0]?.entered_unit_price).toBe(121);
    expect(result.data?.[0]?.price_mode).toBe("inclusive");
  });

  it("divides line net_amount by quantity for inclusive unit_cost", () => {
    const result = toNetPurchaseLines(
      [line({ unit_cost: 12.1, quantity: 10, price_mode: "inclusive" })],
      taxResult([
        taxLine({
          net_amount: 100,
          tax_amount: 21,
          gross_amount: 121,
        }),
      ]),
    );

    expect(result.error).toBeNull();
    expect(result.data?.[0]?.unit_cost).toBe(10);
    expect(result.data?.[0]?.entered_unit_price).toBe(12.1);
  });

  it("does not convert exclusive lines even when tax net_amount differs", () => {
    const result = toNetPurchaseLines(
      [line({ unit_cost: 50, price_mode: "exclusive" })],
      taxResult([taxLine({ net_amount: 999 })]),
    );

    expect(result.data?.[0]?.unit_cost).toBe(50);
    expect(result.data?.[0]?.entered_unit_price).toBe(50);
  });

  it("treats omitted price_mode as exclusive", () => {
    const result = toNetPurchaseLines(
      [line({ price_mode: null, unit_cost: 80 })],
      taxResult(),
    );

    expect(result.data?.[0]?.unit_cost).toBe(80);
    expect(result.data?.[0]?.price_mode).toBe("exclusive");
    expect(result.data?.[0]?.entered_unit_price).toBe(80);
  });

  it("adds discount back into inclusive unit_cost so sql/069 subtracts it only once", () => {
    const quantity = 10;
    const discount = 5;
    const netAmount = 95.87;

    const result = toNetPurchaseLines(
      [
        line({
          unit_cost: 12.1,
          quantity,
          discount,
          price_mode: "inclusive",
        }),
      ],
      taxResult([
        taxLine({
          net_amount: netAmount,
          tax_amount: 20.13,
          gross_amount: 116,
        }),
      ]),
    );

    expect(result.error).toBeNull();
    expect(result.data?.[0]?.unit_cost).toBe(10.087);
    expect(result.data?.[0]?.entered_unit_price).toBe(12.1);
    expect(result.data?.[0]?.discount).toBe(discount);
    expect(
      purchaseTotalsLineTotal(
        quantity,
        result.data?.[0]?.unit_cost ?? Number.NaN,
        discount,
      ),
    ).toBe(netAmount);
  });

  it("fails when an inclusive line has no matching tax result line", () => {
    const result = toNetPurchaseLines(
      [line({ price_mode: "inclusive", unit_cost: 121 })],
      taxResult([]),
    );

    expect(result.data).toBeNull();
    expect(result.error).toMatch(/missing a line/i);
  });
});
