import { describe, expect, it } from "vitest";
import {
  RECEIPT_JSON_SCHEMA,
  parseReceiptRecognition,
  parseStoredReceiptRecognition,
} from "./receipt-recognition-result";

type Json = Record<string, unknown>;

function line(overrides: Json = {}): Json {
  return {
    text: "  AH Volle melk 1L ",
    quantity: 2,
    unit_price: 1.29,
    line_total: 2.58,
    vat_rate: 9,
    kind: "item",
    ...overrides,
  };
}

function sample(overrides: Json = {}): Json {
  return {
    readable: true,
    store_name: " Albert Heijn ",
    receipt_date: "2026-10-05",
    currency: "EUR",
    total: 1.83,
    lines: [line(), line({ text: "BONUS melk", quantity: null, unit_price: null, line_total: -0.75, kind: "DISCOUNT" })],
    ...overrides,
  };
}

describe("parseReceiptRecognition", () => {
  it("normalizes a valid sample to camelCase with schemaVersion 1", () => {
    expect(parseReceiptRecognition(sample())).toEqual({
      schemaVersion: 1,
      readable: true,
      storeName: "Albert Heijn",
      receiptDate: "2026-10-05",
      currency: "EUR",
      total: 1.83,
      lines: [
        {
          text: "AH Volle melk 1L",
          quantity: 2,
          unitPrice: 1.29,
          lineTotal: 2.58,
          vatRate: 9,
          kind: "item",
        },
        {
          text: "BONUS melk",
          quantity: null,
          unitPrice: null,
          lineTotal: -0.75,
          vatRate: 9,
          kind: "discount",
        },
      ],
    });
  });

  it("rounds money to 2 decimals and quantity to 3", () => {
    const result = parseReceiptRecognition(
      sample({
        total: 12.3456,
        lines: [line({ quantity: 0.51249, unit_price: 3.999, line_total: 2.0449 })],
      }),
    );

    expect(result?.total).toBe(12.35);
    expect(result?.lines[0]).toMatchObject({ quantity: 0.512, unitPrice: 4, lineTotal: 2.04 });
  });

  it("accepts an unreadable receipt with no lines and null header fields", () => {
    expect(
      parseReceiptRecognition(
        sample({
          readable: false,
          store_name: null,
          receipt_date: null,
          currency: null,
          total: null,
          lines: [],
        }),
      ),
    ).toMatchObject({ readable: false, storeName: null, receiptDate: null, total: null, lines: [] });
  });

  const tooManyLines = Array.from({ length: 201 }, () => line());

  const violations: Array<[string, unknown]> = [
    ["not an object", "{}"],
    ["an array", []],
    ["readable not boolean", sample({ readable: "yes" })],
    ["a required field missing", (() => {
      const value = sample();
      delete value.currency;
      return value;
    })()],
    ["readable with no lines", sample({ lines: [] })],
    ["more than 200 lines", sample({ lines: tooManyLines })],
    ["lines not an array", sample({ lines: "none" })],
    ["empty line text", sample({ lines: [line({ text: "   " })] })],
    ["line text over 200", sample({ lines: [line({ text: "x".repeat(201) })] })],
    ["line text not a string", sample({ lines: [line({ text: 5 })] })],
    ["store name over 100", sample({ store_name: "s".repeat(101) })],
    ["currency over 100", sample({ currency: "c".repeat(101) })],
    ["store name not a string", sample({ store_name: 7 })],
    ["receipt date not YYYY-MM-DD", sample({ receipt_date: "05-10-2026" })],
    ["receipt date not a real day", sample({ receipt_date: "2026-02-30" })],
    ["total not finite", sample({ total: Number.POSITIVE_INFINITY })],
    ["total negative", sample({ total: -1 })],
    ["total over 1000000", sample({ total: 1000000.01 })],
    ["quantity zero", sample({ lines: [line({ quantity: 0 })] })],
    ["quantity negative", sample({ lines: [line({ quantity: -1 })] })],
    ["quantity over 100000", sample({ lines: [line({ quantity: 100001 })] })],
    ["quantity rounding to zero", sample({ lines: [line({ quantity: 0.0001 })] })],
    ["quantity NaN", sample({ lines: [line({ quantity: Number.NaN })] })],
    ["unit price over 100000", sample({ lines: [line({ unit_price: -100000.01 })] })],
    ["unit price not a number", sample({ lines: [line({ unit_price: "1,29" })] })],
    ["line total over 100000", sample({ lines: [line({ line_total: 100000.01 })] })],
    ["line total null", sample({ lines: [line({ line_total: null })] })],
    ["vat rate negative", sample({ lines: [line({ vat_rate: -1 })] })],
    ["vat rate over 100", sample({ lines: [line({ vat_rate: 101 })] })],
    ["kind outside the enum", sample({ lines: [line({ kind: "fee" })] })],
    ["kind not a string", sample({ lines: [line({ kind: null })] })],
    ["line not an object", sample({ lines: ["milk"] })],
  ];

  it.each(violations)("returns null when %s", (_name, value) => {
    expect(parseReceiptRecognition(value)).toBeNull();
  });

  it("describes every field as required with no additional properties", () => {
    expect(RECEIPT_JSON_SCHEMA.required).toEqual([
      "readable",
      "store_name",
      "receipt_date",
      "currency",
      "total",
      "lines",
    ]);
    expect(RECEIPT_JSON_SCHEMA.additionalProperties).toBe(false);
    expect(RECEIPT_JSON_SCHEMA.properties.lines.items.additionalProperties).toBe(false);
    expect(RECEIPT_JSON_SCHEMA.properties.lines.items.required).toHaveLength(6);
    expect(RECEIPT_JSON_SCHEMA.properties.lines.items.properties.kind.enum).toEqual([
      "item",
      "discount",
      "deposit",
      "bag",
      "other",
    ]);
  });
});

describe("parseStoredReceiptRecognition", () => {
  it("round-trips a normalized result", () => {
    const normalized = parseReceiptRecognition(sample());

    expect(parseStoredReceiptRecognition(normalized)).toEqual(normalized);
  });

  it("rejects another schema version or a model-shaped object", () => {
    const normalized = parseReceiptRecognition(sample());

    expect(parseStoredReceiptRecognition({ ...normalized, schemaVersion: 2 })).toBeNull();
    expect(parseStoredReceiptRecognition(sample())).toBeNull();
    expect(parseStoredReceiptRecognition(null)).toBeNull();
  });
});
