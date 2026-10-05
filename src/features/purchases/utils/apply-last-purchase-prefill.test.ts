import { describe, expect, it } from "vitest";
import { formatMoney } from "@/lib/money";
import {
  emptyPrefillTouch,
  fillLastPricesNote,
  formatLastPurchaseHint,
  formatLastPurchaseHintDate,
  automaticPrefillEventKey,
  planAutomaticPrefill,
  planFillLastPrices,
  planUseLastPurchase,
  resolveLastPurchaseSource,
  type LastPurchaseLineLookup,
  type LastPurchaseLineSnapshot,
  type PrefillTouchState,
} from "./apply-last-purchase-prefill";

const PURCHASED_AT = "2026-09-26T12:00:00.000Z";
const HINT_NOW = new Date("2026-10-02T12:00:00.000Z");

function snapshot(
  overrides: Partial<LastPurchaseLineSnapshot> = {},
): LastPurchaseLineSnapshot {
  return {
    enteredUnitPrice: 14.68,
    unitCost: 13.4679,
    priceMode: "inclusive",
    taxCategory: "food",
    taxRegime: "reduced_vat",
    purchasedAt: PURCHASED_AT,
    supplierId: "supplier-makro",
    supplierName: "Makro",
    ...overrides,
  };
}

function lookup(
  overrides: Partial<LastPurchaseLineLookup> = {},
): LastPurchaseLineLookup {
  return {
    ingredientId: "ing-1",
    supplierLine: snapshot(),
    anyLine: snapshot(),
    ...overrides,
  };
}

const untouched = emptyPrefillTouch();

function touched(partial: Partial<PrefillTouchState>): PrefillTouchState {
  return { ...untouched, ...partial };
}

describe("resolveLastPurchaseSource", () => {
  it("prefers the same supplier over a newer global line", () => {
    const source = resolveLastPurchaseSource(
      lookup({
        supplierLine: snapshot({ enteredUnitPrice: 14.68, supplierName: "Makro" }),
        anyLine: snapshot({
          enteredUnitPrice: 20,
          supplierId: "supplier-sligro",
          supplierName: "Sligro",
        }),
      }),
      "supplier-makro",
    );

    expect(source?.kind).toBe("supplier");
    expect(source?.unitPrice).toBe(14.68);
    expect(source?.otherSupplier).toBe(false);
  });

  it("falls through to any supplier when the document supplier has no row", () => {
    const source = resolveLastPurchaseSource(
      lookup({
        supplierLine: null,
        anyLine: snapshot({
          enteredUnitPrice: 20,
          supplierId: "supplier-sligro",
          supplierName: "Sligro",
        }),
      }),
      "supplier-makro",
    );

    expect(source?.kind).toBe("any");
    expect(source?.unitPrice).toBe(20);
    expect(source?.otherSupplier).toBe(true);
  });

  it("uses unit_cost as exclusive net when entered_unit_price is null", () => {
    const source = resolveLastPurchaseSource(
      lookup({
        supplierLine: snapshot({
          enteredUnitPrice: null,
          unitCost: 9.5,
          priceMode: null,
          taxCategory: null,
          taxRegime: null,
        }),
        anyLine: null,
      }),
      "supplier-makro",
    );

    expect(source?.net).toBe(true);
    expect(source?.unitPrice).toBe(9.5);
    expect(source?.priceMode).toBe("exclusive");
    expect(source?.taxCategory).toBeNull();
  });

  it("ignores supplierLine fetched for a different supplier", () => {
    const source = resolveLastPurchaseSource(
      lookup({
        supplierLine: snapshot({
          enteredUnitPrice: 14.68,
          supplierId: "supplier-makro",
          supplierName: "Makro",
        }),
        anyLine: snapshot({
          enteredUnitPrice: 20,
          supplierId: "supplier-sligro",
          supplierName: "Sligro",
        }),
      }),
      "supplier-sligro",
      "supplier-makro",
    );

    expect(source?.kind).toBe("any");
    expect(source?.unitPrice).toBe(20);
    expect(source?.otherSupplier).toBe(false);
  });

  it("returns no source when the stale supplier line is the only row", () => {
    const source = resolveLastPurchaseSource(
      lookup({
        supplierLine: snapshot({ enteredUnitPrice: 14.68 }),
        anyLine: null,
      }),
      "supplier-sligro",
      "supplier-makro",
    );

    expect(source).toBeNull();
  });

  it("uses supplierLine once the lookup was fetched for the current supplier", () => {
    const source = resolveLastPurchaseSource(
      lookup({
        supplierLine: snapshot({ enteredUnitPrice: 9, supplierName: "Sligro" }),
        anyLine: snapshot({ enteredUnitPrice: 20, supplierName: "Makro" }),
      }),
      "supplier-sligro",
      "supplier-sligro",
    );

    expect(source?.kind).toBe("supplier");
    expect(source?.unitPrice).toBe(9);
  });
});

describe("formatLastPurchaseHint", () => {
  it("renders price, current unit, date, and supplier", () => {
    const source = resolveLastPurchaseSource(lookup(), "supplier-makro");
    expect(source).not.toBeNull();
    expect(formatLastPurchaseHint(source!, "kg", HINT_NOW)).toBe(
      `last: ${formatMoney(14.68)} / kg · 26 Sep · Makro`,
    );
  });

  it("appends net for a pre-sql/102 row", () => {
    const source = resolveLastPurchaseSource(
      lookup({
        supplierLine: snapshot({
          enteredUnitPrice: null,
          unitCost: 9.5,
          priceMode: null,
        }),
      }),
      "supplier-makro",
    );
    expect(formatLastPurchaseHint(source!, "kg", HINT_NOW)).toBe(
      `last: ${formatMoney(9.5)} / kg · 26 Sep · Makro · net`,
    );
  });

  it("marks a line that came from another supplier", () => {
    const source = resolveLastPurchaseSource(
      lookup({
        supplierLine: null,
        anyLine: snapshot({
          supplierId: "supplier-sligro",
          supplierName: "Sligro",
          enteredUnitPrice: 20,
        }),
      }),
      "supplier-makro",
    );
    expect(formatLastPurchaseHint(source!, "kg", HINT_NOW)).toBe(
      `last: ${formatMoney(20)} / kg · 26 Sep · other supplier: Sligro`,
    );
  });
});

describe("formatLastPurchaseHintDate", () => {
  it("omits the year when purchased_at is in the injected current year", () => {
    expect(formatLastPurchaseHintDate(PURCHASED_AT, HINT_NOW)).toBe("26 Sep");
  });

  it("includes the year when purchased_at is not in the injected current year", () => {
    expect(
      formatLastPurchaseHintDate("2025-09-26T12:00:00.000Z", HINT_NOW),
    ).toBe("26 Sep 2025");
  });
});

describe("planAutomaticPrefill", () => {
  const source = resolveLastPurchaseSource(lookup(), "supplier-makro");

  it("fills price and tax on a new line whose seed has not been edited", () => {
    expect(
      planAutomaticPrefill(source, {
        readOnly: false,
        loadedFromDatabase: false,
        ingredientChanged: false,
        touched: untouched,
        helperOwned: untouched,
      }),
    ).toEqual({
      unitPrice: 14.68,
      priceMode: "inclusive",
      taxCategory: "food",
      taxRegime: "reduced_vat",
    });
  });

  it("skips fields the user already edited", () => {
    expect(
      planAutomaticPrefill(source, {
        readOnly: false,
        loadedFromDatabase: false,
        ingredientChanged: false,
        touched: touched({ unitCost: true, priceMode: true }),
        helperOwned: untouched,
      }),
    ).toEqual({
      taxCategory: "food",
      taxRegime: "reduced_vat",
    });
  });

  it("does not prefill a line loaded from the database until the ingredient changes", () => {
    expect(
      planAutomaticPrefill(source, {
        readOnly: false,
        loadedFromDatabase: true,
        ingredientChanged: false,
        touched: untouched,
        helperOwned: untouched,
      }),
    ).toBeNull();
  });

  it("prefills after the user picks a different ingredient on a loaded line", () => {
    expect(
      planAutomaticPrefill(source, {
        readOnly: false,
        loadedFromDatabase: true,
        ingredientChanged: true,
        touched: untouched,
        helperOwned: untouched,
      })?.unitPrice,
    ).toBe(14.68);
  });

  it("does not prefill a read-only document", () => {
    expect(
      planAutomaticPrefill(source, {
        readOnly: true,
        loadedFromDatabase: false,
        ingredientChanged: false,
        touched: untouched,
        helperOwned: untouched,
      }),
    ).toBeNull();
  });

  it("replaces helper-owned values when the supplier source changes", () => {
    const other = resolveLastPurchaseSource(
      lookup({
        supplierLine: snapshot({ enteredUnitPrice: 11, priceMode: "exclusive" }),
      }),
      "supplier-makro",
    );

    expect(
      planAutomaticPrefill(other, {
        readOnly: false,
        loadedFromDatabase: true,
        ingredientChanged: false,
        touched: untouched,
        helperOwned: touched({ unitCost: true, priceMode: true }),
      }),
    ).toEqual({
      unitPrice: 11,
      priceMode: "exclusive",
    });
  });
});

describe("planUseLastPurchase", () => {
  it("overrides a loaded, already-edited line", () => {
    const source = resolveLastPurchaseSource(lookup(), "supplier-makro");
    expect(planUseLastPurchase(source)).toEqual({
      unitPrice: 14.68,
      priceMode: "inclusive",
      taxCategory: "food",
      taxRegime: "reduced_vat",
    });
  });
});

describe("planFillLastPrices", () => {
  const source = resolveLastPurchaseSource(lookup(), "supplier-makro");

  it("fills only empty or zero prices and reports the count", () => {
    const plan = planFillLastPrices(
      [
        { unitPrice: "", source, touched: untouched },
        { unitPrice: "0", source, touched: untouched },
        { unitPrice: "5", source, touched: untouched },
        { unitPrice: "", source: null, touched: untouched },
      ],
      false,
    );

    expect(plan.candidates).toBe(3);
    expect(plan.filled).toBe(2);
    expect(plan.patches[0]?.unitPrice).toBe(14.68);
    expect(plan.patches[1]?.unitPrice).toBe(14.68);
    expect(plan.patches[2]).toBeNull();
    expect(plan.patches[3]).toBeNull();
    expect(fillLastPricesNote(plan.filled, plan.candidates)).toBe(
      "Filled 2 of 3 lines",
    );
  });

  it("does not change a non-zero price and keeps a touched tax field", () => {
    const plan = planFillLastPrices(
      [
        {
          unitPrice: "0",
          source,
          touched: touched({ taxCategory: true }),
        },
      ],
      false,
    );

    expect(plan.patches[0]).toEqual({
      unitPrice: 14.68,
      priceMode: "inclusive",
      taxRegime: "reduced_vat",
    });
    expect(plan.patches[0]?.taxCategory).toBeUndefined();
  });

  it("does nothing on a read-only document", () => {
    const plan = planFillLastPrices(
      [{ unitPrice: "0", source, touched: untouched }],
      true,
    );
    expect(plan.filled).toBe(0);
    expect(plan.patches[0]).toBeNull();
  });
});

describe("automaticPrefillEventKey", () => {
  const source = resolveLastPurchaseSource(lookup(), "supplier-makro");

  it("is null until the ingredient has a source", () => {
    expect(automaticPrefillEventKey("", source)).toBeNull();
    expect(automaticPrefillEventKey("flour", null)).toBeNull();
  });

  it("changes when the ingredient or the source identity changes", () => {
    const key = automaticPrefillEventKey("flour", source);
    expect(key).toContain("flour");
    expect(automaticPrefillEventKey("milk", source)).not.toBe(key);

    const otherPrice = resolveLastPurchaseSource(
      lookup({
        supplierLine: snapshot({ enteredUnitPrice: 9 }),
      }),
      "supplier-makro",
    );
    expect(automaticPrefillEventKey("flour", otherPrice)).not.toBe(key);
  });
});
