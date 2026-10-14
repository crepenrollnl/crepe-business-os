/**
 * Accounting Preview mapping coverage (DEV-101).
 *
 * Since sql/150 the database posts the purchase journal from the stored
 * totals; the preview shows exactly those totals.
 */

import { describe, expect, it } from "vitest";
import { mapPurchaseTotalsToAccountingPreview } from "./map-purchase-accounting-preview";

describe("mapPurchaseTotalsToAccountingPreview (DEV-101)", () => {
  it("maps document totals without a journal proposal", () => {
    const preview = mapPurchaseTotalsToAccountingPreview({
      subtotal: 100,
      tax_total: 21,
      total: 121,
      currency: "EUR",
    });

    expect(preview).toEqual({
      net_amount: 100,
      tax_total: 21,
      grand_total: 121,
      currency: "EUR",
      status: "draft_proposal",
      has_proposal: false,
      lines: [],
    });
  });

  it("shows the same amounts the database posts (net, VAT, net + VAT)", () => {
    const stored = { subtotal: 38.47, tax_total: 3.46, total: 41.93, currency: "EUR" };

    const preview = mapPurchaseTotalsToAccountingPreview(stored);

    // sql/150: Dr inventory = subtotal, Dr vat_input = tax_total,
    // Cr cash = subtotal + tax_total (purchases.total is that same sum).
    expect(preview.net_amount).toBe(stored.subtotal);
    expect(preview.tax_total).toBe(stored.tax_total);
    expect(preview.grand_total).toBe(stored.subtotal + stored.tax_total);
  });

  it("maps a zero-VAT purchase (the database posts no VAT line)", () => {
    const preview = mapPurchaseTotalsToAccountingPreview({
      subtotal: 50,
      tax_total: 0,
      total: 50,
      currency: "EUR",
    });

    expect(preview.tax_total).toBe(0);
    expect(preview.grand_total).toBe(preview.net_amount);
  });
});
