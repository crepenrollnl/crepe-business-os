import { describe, expect, it } from "vitest";
import type {
  ReceiptRecognitionLine,
  ReceiptRecognitionResult,
} from "../types/receipt-recognition";
import {
  buildReceiptDraftLines,
  buildUnknownReceiptLine,
  type ReceiptLineMatch,
} from "./receipt-lines-to-draft";

const FLOUR = "ingredient-flour";
const MILK = "ingredient-milk";
const KNOWN = new Set([FLOUR, MILK]);

function line(overrides: Partial<ReceiptRecognitionLine> = {}): ReceiptRecognitionLine {
  return {
    text: "MELK",
    quantity: 2,
    unitPrice: 1.29,
    lineTotal: 2.58,
    vatRate: 9,
    kind: "item",
    ...overrides,
  };
}

function result(
  lines: ReceiptRecognitionLine[],
  total: number | null = 10,
): ReceiptRecognitionResult {
  return {
    schemaVersion: 1,
    readable: true,
    storeName: "Sligro",
    receiptDate: "2026-10-05",
    currency: "EUR",
    total,
    lines,
  };
}

function match(
  lineIndex: number,
  action: ReceiptLineMatch["action"],
  ingredientId: string | null = null,
  unitsPerItem: number | null = null,
): ReceiptLineMatch {
  return { lineIndex, action, ingredientId, unitsPerItem };
}

describe("buildReceiptDraftLines", () => {
  it("adds an unknown item with no ingredient and the printed quantity", () => {
    const built = buildReceiptDraftLines(result([line()]), [match(1, null)], KNOWN);

    expect(built.lines).toEqual([
      {
        ingredientId: "",
        quantity: 2,
        lineTotal: 2.58,
        discount: 0,
        taxCategory: "food",
        taxRegime: "reduced_vat",
        vatUnclear: false,
        receiptSource: { text: "MELK", quantity: 2, lineTotal: 2.58, mapped: null },
      },
    ]);
    expect(built.notAdded).toEqual([]);
  });

  it("uses quantity 1 when the receipt printed none", () => {
    const built = buildReceiptDraftLines(result([line({ quantity: null })]), [], KNOWN);

    expect(built.lines[0]?.quantity).toBe(1);
    expect(built.lines[0]?.receiptSource.quantity).toBeNull();
  });

  it("applies a remembered known ingredient with units per item", () => {
    const built = buildReceiptDraftLines(
      result([line({ quantity: 3 })]),
      [match(1, "ingredient", FLOUR, 0.3333)],
      KNOWN,
    );

    expect(built.lines[0]).toMatchObject({
      ingredientId: FLOUR,
      quantity: 1,
      receiptSource: { mapped: { ingredientId: FLOUR, unitsPerItem: 0.3333 } },
    });
  });

  it("multiplies a missing quantity as 1 and rounds to 3 decimals", () => {
    const built = buildReceiptDraftLines(
      result([line({ quantity: null })]),
      [match(1, "ingredient", MILK, 1.23456)],
      KNOWN,
    );

    expect(built.lines[0]?.quantity).toBe(1.235);
  });

  it("treats a remembered ingredient that is not in the list as unknown", () => {
    const built = buildReceiptDraftLines(
      result([line()]),
      [match(1, "ingredient", "ingredient-gone", 5)],
      KNOWN,
    );

    expect(built.lines[0]).toMatchObject({
      ingredientId: "",
      quantity: 2,
      receiptSource: { mapped: null },
    });
  });

  it("does not add a remembered skip", () => {
    const built = buildReceiptDraftLines(
      result([line({ text: "TAS" })]),
      [match(1, "skip")],
      KNOWN,
    );

    expect(built.lines).toEqual([]);
    expect(built.notAdded).toEqual([
      { text: "TAS", quantity: 2, amount: 2.58, vatRate: 9, reason: "remembered skip" },
    ]);
  });

  it("aligns matches by 1-based line index", () => {
    const built = buildReceiptDraftLines(
      result([line({ text: "TAS", kind: "bag", lineTotal: 0.25 }), line({ text: "MEEL" })]),
      [match(1, null), match(2, "ingredient", FLOUR, 1)],
      KNOWN,
    );

    expect(built.lines).toHaveLength(1);
    expect(built.lines[0]?.ingredientId).toBe(FLOUR);
  });

  it.each([
    ["bag" as const],
    ["deposit" as const],
    ["other" as const],
  ])("does not add a %s line", (kind) => {
    const built = buildReceiptDraftLines(
      result([line({ kind, lineTotal: 0.15 })]),
      [],
      KNOWN,
    );

    expect(built.lines).toEqual([]);
    expect(built.notAdded[0]?.reason).toBe(kind);
  });

  it.each([[0], [-1.5]])("does not add an item with line total %s", (lineTotal) => {
    const built = buildReceiptDraftLines(result([line({ lineTotal })]), [], KNOWN);

    expect(built.lines).toEqual([]);
    expect(built.notAdded[0]?.reason).toBe("no amount");
  });

  it("adds a discount to the nearest preceding produced item", () => {
    const built = buildReceiptDraftLines(
      result([
        line({ text: "MEEL", lineTotal: 5 }),
        line({ text: "MELK", lineTotal: 3 }),
        line({ text: "TAS", kind: "bag", lineTotal: 0.25 }),
        line({ text: "BONUS", kind: "discount", lineTotal: -1.2 }),
        line({ text: "KORTING", kind: "discount", lineTotal: -0.3 }),
      ]),
      [],
      KNOWN,
    );

    expect(built.lines.map((row) => row.discount)).toEqual([0, 1.5]);
    expect(built.lines[1]?.lineTotal).toBe(3);
  });

  it("does not add a discount with no preceding item", () => {
    const built = buildReceiptDraftLines(
      result([line({ text: "BONUS", kind: "discount", lineTotal: -1 }), line()]),
      [],
      KNOWN,
    );

    expect(built.lines[0]?.discount).toBe(0);
    expect(built.notAdded).toEqual([
      { text: "BONUS", quantity: 2, amount: -1, vatRate: 9, reason: "discount" },
    ]);
  });

  it("does not add a discount larger than the item's line total", () => {
    const built = buildReceiptDraftLines(
      result([
        line({ lineTotal: 2 }),
        line({ text: "BONUS", kind: "discount", lineTotal: -1.5 }),
        line({ text: "ACTIE", kind: "discount", lineTotal: -0.51 }),
      ]),
      [],
      KNOWN,
    );

    expect(built.lines[0]?.discount).toBe(1.5);
    expect(built.notAdded.map((row) => row.text)).toEqual(["ACTIE"]);
  });

  it("skips a remembered-skip item when looking for the discount target", () => {
    const built = buildReceiptDraftLines(
      result([
        line({ text: "MEEL", lineTotal: 4 }),
        line({ text: "STATIEGELD", lineTotal: 1 }),
        line({ text: "BONUS", kind: "discount", lineTotal: -1 }),
      ]),
      [match(2, "skip")],
      KNOWN,
    );

    expect(built.lines).toHaveLength(1);
    expect(built.lines[0]?.discount).toBe(1);
  });

  it.each([
    [9, "food", "reduced_vat", false],
    [21, "goods", "standard_vat", false],
    [null, "food", "reduced_vat", true],
    [0, "food", "reduced_vat", true],
    [6, "food", "reduced_vat", true],
  ])("maps VAT %s to %s / %s (unclear %s)", (vatRate, category, regime, unclear) => {
    const built = buildReceiptDraftLines(result([line({ vatRate })]), [], KNOWN);

    expect(built.lines[0]).toMatchObject({
      taxCategory: category,
      taxRegime: regime,
      vatUnclear: unclear,
    });
  });

  it("rounds amounts to 2 decimals", () => {
    const built = buildReceiptDraftLines(
      result([
        line({ lineTotal: 2.005 }),
        line({ text: "BONUS", kind: "discount", lineTotal: -0.333 }),
      ]),
      [],
      KNOWN,
    );

    expect(built.lines[0]?.lineTotal).toBe(2.01);
    expect(built.lines[0]?.discount).toBe(0.33);
  });

  it("summarizes the receipt total, added and not added amounts", () => {
    const built = buildReceiptDraftLines(
      result(
        [
          line({ text: "MEEL", lineTotal: 5 }),
          line({ text: "BONUS", kind: "discount", lineTotal: -1 }),
          line({ text: "MELK", lineTotal: 2.5 }),
          line({ text: "TAS", kind: "bag", lineTotal: 0.25 }),
          line({ text: "STATIEGELD", kind: "deposit", lineTotal: 0.15 }),
        ],
        6.9,
      ),
      [],
      KNOWN,
    );

    expect(built.summary).toEqual({ receiptTotal: 6.9, addedTotal: 6.5, notAddedTotal: 0.4 });
  });

  it("keeps a null receipt total", () => {
    expect(buildReceiptDraftLines(result([line()], null), [], KNOWN).summary.receiptTotal).toBeNull();
  });
});

describe("buildUnknownReceiptLine", () => {
  it("adds a not-added line with no ingredient and its amount", () => {
    expect(
      buildUnknownReceiptLine({
        text: "TAS",
        quantity: null,
        amount: 0.25,
        vatRate: 21,
        reason: "bag",
      }),
    ).toEqual({
      ingredientId: "",
      quantity: 1,
      lineTotal: 0.25,
      discount: 0,
      taxCategory: "goods",
      taxRegime: "standard_vat",
      vatUnclear: false,
      receiptSource: { text: "TAS", quantity: null, lineTotal: 0.25, mapped: null },
    });
  });
});
