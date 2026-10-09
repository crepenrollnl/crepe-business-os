import { roundMoney } from "@/lib/money";
import {
  RECEIPT_LINE_KINDS,
  RECEIPT_RECOGNITION_SCHEMA_VERSION,
  type ReceiptLineKind,
  type ReceiptRecognitionLine,
  type ReceiptRecognitionResult,
} from "../types/receipt-recognition";

const MAX_LINES = 200;
const MAX_LINE_TEXT = 200;
const MAX_HEADER_TEXT = 100;
const MAX_QUANTITY = 100000;
const MAX_LINE_AMOUNT = 100000;
const MAX_TOTAL = 1000000;
const QUANTITY_FACTOR = 1000;

/** JSON schema the model must answer with (Anthropic structured output). */
export const RECEIPT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["readable", "store_name", "receipt_date", "currency", "total", "lines"],
  properties: {
    readable: { type: "boolean" },
    store_name: { type: ["string", "null"] },
    receipt_date: { type: ["string", "null"] },
    currency: { type: ["string", "null"] },
    total: { type: ["number", "null"] },
    lines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "quantity", "unit_price", "line_total", "vat_rate", "kind"],
        properties: {
          text: { type: "string" },
          quantity: { type: ["number", "null"] },
          unit_price: { type: ["number", "null"] },
          line_total: { type: "number" },
          vat_rate: { type: ["number", "null"] },
          kind: { type: "string", enum: [...RECEIPT_LINE_KINDS] },
        },
      },
    },
  },
} as const;

/** Thrown internally on the first rule violation; never escapes this module. */
class InvalidRecognition extends Error {}

function invalid(): never {
  throw new InvalidRecognition();
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalid();
  }
  return value as Record<string, unknown>;
}

function field(record: Record<string, unknown>, key: string): unknown {
  if (!(key in record)) {
    invalid();
  }
  return record[key];
}

function finiteNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    invalid();
  }
  return value;
}

function nullableNumber(value: unknown): number | null {
  return value === null ? null : finiteNumber(value);
}

function headerText(value: unknown): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    invalid();
  }
  const trimmed = value.trim();
  if (trimmed.length > MAX_HEADER_TEXT) {
    invalid();
  }
  return trimmed.length > 0 ? trimmed : null;
}

function isRealIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function receiptDate(value: unknown): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string" || !isRealIsoDate(value)) {
    invalid();
  }
  return value;
}

function roundQuantity(value: number): number {
  return Math.round(value * QUANTITY_FACTOR) / QUANTITY_FACTOR;
}

function lineKind(value: unknown): ReceiptLineKind {
  if (typeof value !== "string") {
    invalid();
  }
  const lowered = value.trim().toLowerCase();
  const kind = RECEIPT_LINE_KINDS.find((candidate) => candidate === lowered);
  if (!kind) {
    invalid();
  }
  return kind;
}

function parseLine(value: unknown): ReceiptRecognitionLine {
  const record = asRecord(value);

  const rawText = field(record, "text");
  if (typeof rawText !== "string") {
    invalid();
  }
  const text = rawText.trim();
  if (text.length < 1 || text.length > MAX_LINE_TEXT) {
    invalid();
  }

  const rawQuantity = nullableNumber(field(record, "quantity"));
  let quantity: number | null = null;
  if (rawQuantity !== null) {
    if (rawQuantity <= 0 || rawQuantity > MAX_QUANTITY) {
      invalid();
    }
    quantity = roundQuantity(rawQuantity);
    if (quantity <= 0) {
      invalid();
    }
  }

  const rawUnitPrice = nullableNumber(field(record, "unit_price"));
  if (rawUnitPrice !== null && Math.abs(rawUnitPrice) > MAX_LINE_AMOUNT) {
    invalid();
  }

  const rawLineTotal = finiteNumber(field(record, "line_total"));
  if (Math.abs(rawLineTotal) > MAX_LINE_AMOUNT) {
    invalid();
  }

  const vatRate = nullableNumber(field(record, "vat_rate"));
  if (vatRate !== null && (vatRate < 0 || vatRate > 100)) {
    invalid();
  }

  return {
    text,
    quantity,
    unitPrice: rawUnitPrice === null ? null : roundMoney(rawUnitPrice),
    lineTotal: roundMoney(rawLineTotal),
    vatRate,
    kind: lineKind(field(record, "kind")),
  };
}

function parseResult(json: unknown): ReceiptRecognitionResult {
  const record = asRecord(json);

  const readable = field(record, "readable");
  if (typeof readable !== "boolean") {
    invalid();
  }

  const rawTotal = nullableNumber(field(record, "total"));
  if (rawTotal !== null && (rawTotal < 0 || rawTotal > MAX_TOTAL)) {
    invalid();
  }

  const rawLines = field(record, "lines");
  if (!Array.isArray(rawLines) || rawLines.length > MAX_LINES) {
    invalid();
  }
  // Only an unreadable photo may come back without lines.
  if (readable && rawLines.length === 0) {
    invalid();
  }

  return {
    schemaVersion: RECEIPT_RECOGNITION_SCHEMA_VERSION,
    readable,
    storeName: headerText(field(record, "store_name")),
    receiptDate: receiptDate(field(record, "receipt_date")),
    currency: headerText(field(record, "currency")),
    total: rawTotal === null ? null : roundMoney(rawTotal),
    lines: rawLines.map(parseLine),
  };
}

function storedToModelShape(value: unknown): Record<string, unknown> {
  const record = asRecord(value);
  if (field(record, "schemaVersion") !== RECEIPT_RECOGNITION_SCHEMA_VERSION) {
    invalid();
  }
  const lines = field(record, "lines");
  if (!Array.isArray(lines)) {
    invalid();
  }
  return {
    readable: field(record, "readable"),
    store_name: field(record, "storeName"),
    receipt_date: field(record, "receiptDate"),
    currency: field(record, "currency"),
    total: field(record, "total"),
    lines: lines.map((line) => {
      const item = asRecord(line);
      return {
        text: field(item, "text"),
        quantity: field(item, "quantity"),
        unit_price: field(item, "unitPrice"),
        line_total: field(item, "lineTotal"),
        vat_rate: field(item, "vatRate"),
        kind: field(item, "kind"),
      };
    }),
  };
}

function nullOnViolation(read: () => ReceiptRecognitionResult): ReceiptRecognitionResult | null {
  try {
    return read();
  } catch (error) {
    if (error instanceof InvalidRecognition) {
      return null;
    }
    throw error;
  }
}

/**
 * Validates the model's JSON (snake_case, RECEIPT_JSON_SCHEMA) and returns the
 * normalized camelCase result, or null when any rule is violated.
 */
export function parseReceiptRecognition(json: unknown): ReceiptRecognitionResult | null {
  return nullOnViolation(() => parseResult(json));
}

/**
 * Validates an already normalized result (a stored row or an API response)
 * with the same rules, or null when it does not match schemaVersion 1.
 */
export function parseStoredReceiptRecognition(
  value: unknown,
): ReceiptRecognitionResult | null {
  return nullOnViolation(() => parseResult(storedToModelShape(value)));
}
