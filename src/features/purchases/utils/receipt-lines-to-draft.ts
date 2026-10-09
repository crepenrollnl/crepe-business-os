import { roundMoney } from "@/lib/money";
import type {
  ReceiptRecognitionLine,
  ReceiptRecognitionResult,
} from "../types/receipt-recognition";

/** One row of match_receipt_lines, aligned to result.lines by 1-based lineIndex. */
export interface ReceiptLineMatch {
  lineIndex: number;
  action: "ingredient" | "skip" | null;
  ingredientId: string | null;
  unitsPerItem: number | null;
}

export interface ReceiptLineMapping {
  ingredientId: string;
  unitsPerItem: number;
}

/** What the receipt printed for a purchase line, kept on the form line (UI only). */
export interface ReceiptLineSource {
  text: string;
  /** As printed; null when the receipt printed no quantity. */
  quantity: number | null;
  lineTotal: number;
  /** The remembered mapping that was applied, or null. */
  mapped: ReceiptLineMapping | null;
}

export interface BuiltReceiptLine {
  ingredientId: string;
  quantity: number;
  /** Printed amount, before discount. */
  lineTotal: number;
  discount: number;
  taxCategory: string;
  taxRegime: string;
  vatUnclear: boolean;
  receiptSource: ReceiptLineSource;
}

export type NotAddedReason =
  | "discount"
  | "bag"
  | "deposit"
  | "other"
  | "no amount"
  | "remembered skip";

export interface NotAddedReceiptLine {
  text: string;
  quantity: number | null;
  amount: number;
  vatRate: number | null;
  reason: NotAddedReason;
}

export interface ReceiptDraftSummary {
  receiptTotal: number | null;
  addedTotal: number;
  notAddedTotal: number;
}

export interface ReceiptDraftBuild {
  lines: BuiltReceiptLine[];
  notAdded: NotAddedReceiptLine[];
  summary: ReceiptDraftSummary;
}

const QUANTITY_FACTOR = 1000;

function roundQuantity(value: number): number {
  return Math.round(value * QUANTITY_FACTOR) / QUANTITY_FACTOR;
}

function taxForVatRate(vatRate: number | null): {
  taxCategory: string;
  taxRegime: string;
  vatUnclear: boolean;
} {
  if (vatRate === 9) {
    return { taxCategory: "food", taxRegime: "reduced_vat", vatUnclear: false };
  }
  if (vatRate === 21) {
    return { taxCategory: "goods", taxRegime: "standard_vat", vatUnclear: false };
  }
  return { taxCategory: "food", taxRegime: "reduced_vat", vatUnclear: true };
}

function knownMapping(
  match: ReceiptLineMatch | undefined,
  knownIngredientIds: ReadonlySet<string>,
): ReceiptLineMapping | null {
  if (
    match?.action !== "ingredient" ||
    !match.ingredientId ||
    !knownIngredientIds.has(match.ingredientId) ||
    match.unitsPerItem === null ||
    !(match.unitsPerItem > 0)
  ) {
    return null;
  }
  return { ingredientId: match.ingredientId, unitsPerItem: match.unitsPerItem };
}

function builtLine(
  line: Pick<ReceiptRecognitionLine, "text" | "quantity" | "lineTotal" | "vatRate">,
  mapped: ReceiptLineMapping | null,
): BuiltReceiptLine {
  const printedQuantity = line.quantity ?? 1;
  return {
    ingredientId: mapped?.ingredientId ?? "",
    quantity: roundQuantity(mapped ? printedQuantity * mapped.unitsPerItem : printedQuantity),
    lineTotal: roundMoney(line.lineTotal),
    discount: 0,
    ...taxForVatRate(line.vatRate),
    receiptSource: {
      text: line.text,
      quantity: line.quantity,
      lineTotal: roundMoney(line.lineTotal),
      mapped,
    },
  };
}

function notAdded(line: ReceiptRecognitionLine, reason: NotAddedReason): NotAddedReceiptLine {
  return {
    text: line.text,
    quantity: line.quantity,
    amount: roundMoney(line.lineTotal),
    vatRate: line.vatRate,
    reason,
  };
}

/**
 * Turns a receipt recognition into purchase form lines. Items become lines
 * (with a remembered ingredient when one is known), discounts reduce the
 * nearest preceding item, and everything else is listed as not added.
 */
export function buildReceiptDraftLines(
  result: ReceiptRecognitionResult,
  matches: readonly ReceiptLineMatch[],
  knownIngredientIds: ReadonlySet<string>,
): ReceiptDraftBuild {
  const lines: BuiltReceiptLine[] = [];
  const skipped: NotAddedReceiptLine[] = [];

  result.lines.forEach((line, index) => {
    if (line.kind === "discount") {
      const target = lines[lines.length - 1];
      const amount = Math.abs(line.lineTotal);
      if (!target || roundMoney(target.discount + amount) > target.lineTotal) {
        skipped.push(notAdded(line, "discount"));
        return;
      }
      target.discount = roundMoney(target.discount + amount);
      return;
    }

    if (line.kind !== "item") {
      skipped.push(notAdded(line, line.kind));
      return;
    }

    if (line.lineTotal <= 0) {
      skipped.push(notAdded(line, "no amount"));
      return;
    }

    const match = matches.find((row) => row.lineIndex === index + 1);
    if (match?.action === "skip") {
      skipped.push(notAdded(line, "remembered skip"));
      return;
    }

    lines.push(builtLine(line, knownMapping(match, knownIngredientIds)));
  });

  return {
    lines,
    notAdded: skipped,
    summary: {
      receiptTotal: result.total,
      addedTotal: roundMoney(
        lines.reduce((sum, line) => sum + line.lineTotal - line.discount, 0),
      ),
      notAddedTotal: roundMoney(skipped.reduce((sum, line) => sum + line.amount, 0)),
    },
  };
}

/** A not-added receipt line the user chose to add anyway, with no ingredient. */
export function buildUnknownReceiptLine(line: NotAddedReceiptLine): BuiltReceiptLine {
  return builtLine(
    { text: line.text, quantity: line.quantity, lineTotal: line.amount, vatRate: line.vatRate },
    null,
  );
}
