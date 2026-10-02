/**
 * Pure last-received-price hint for the purchase document form.
 *
 * The database function returns the latest received line for the document
 * supplier and the latest received line from any supplier. This module
 * decides which fields the form may copy. It does not save, receive, or
 * recalculate tax — the modal applies a unit-price change through the
 * same handler the unit-price input uses.
 */

import { formatMoney } from "@/lib/money";
import { parseNumericInput } from "@/components/ui/numeric-input";

export interface LastPurchaseLineSnapshot {
  enteredUnitPrice: number | null;
  unitCost: number;
  priceMode: "exclusive" | "inclusive" | null;
  taxCategory: string | null;
  taxRegime: string | null;
  purchasedAt: string;
  supplierId: string | null;
  supplierName: string | null;
}

export interface LastPurchaseLineLookup {
  ingredientId: string;
  supplierLine: LastPurchaseLineSnapshot | null;
  anyLine: LastPurchaseLineSnapshot | null;
}

export interface PrefillTouchState {
  unitCost: boolean;
  priceMode: boolean;
  taxCategory: boolean;
  taxRegime: boolean;
}

export interface LastPurchaseSource {
  line: LastPurchaseLineSnapshot;
  kind: "supplier" | "any";
  /** True when the document has a supplier and the chosen line is from another one. */
  otherSupplier: boolean;
  /** True for pre-sql/102 rows, which stored only exclusive net unit_cost. */
  net: boolean;
  unitPrice: number;
  priceMode: "exclusive" | "inclusive";
  taxCategory: string | null;
  taxRegime: string | null;
}

export interface AutomaticPrefillInput {
  readOnly: boolean;
  loadedFromDatabase: boolean;
  ingredientChanged: boolean;
  touched: PrefillTouchState;
  /** Fields last written by automatic prefill or Fill last prices, not by typing. */
  helperOwned: PrefillTouchState;
}

export interface LastPurchaseFieldPatch {
  unitPrice?: number;
  priceMode?: "exclusive" | "inclusive";
  taxCategory?: string;
  taxRegime?: string;
}

const HINT_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export function emptyPrefillTouch(): PrefillTouchState {
  return {
    unitCost: false,
    priceMode: false,
    taxCategory: false,
    taxRegime: false,
  };
}

export function isEmptyOrZeroUnitPrice(raw: string): boolean {
  const parsed = parseNumericInput(raw);
  return parsed === null || parsed === 0;
}

function normalizeSupplierId(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Same-supplier received line when the document has one; otherwise the
 * latest received line from any supplier.
 *
 * `fetchedForSupplierId` is the supplier the lookup was loaded for. Until
 * that matches the document supplier, `supplierLine` is ignored so a
 * supplier change cannot apply the previous supplier's row. Omit it only
 * when the lookup is already known to belong to `documentSupplierId`.
 */
export function resolveLastPurchaseSource(
  lookup: LastPurchaseLineLookup | null,
  documentSupplierId: string | null,
  fetchedForSupplierId?: string | null,
): LastPurchaseSource | null {
  if (!lookup) {
    return null;
  }

  const supplierId = normalizeSupplierId(documentSupplierId);
  const fetchedFor =
    fetchedForSupplierId === undefined
      ? supplierId
      : normalizeSupplierId(fetchedForSupplierId);
  const supplierLine =
    supplierId && fetchedFor === supplierId ? lookup.supplierLine : null;
  const line = supplierLine ?? lookup.anyLine;
  if (!line) {
    return null;
  }

  const entered = line.enteredUnitPrice;
  const net = entered === null;
  const unitPrice = net ? line.unitCost : entered;
  if (unitPrice === null || !Number.isFinite(unitPrice) || unitPrice <= 0) {
    return null;
  }

  const priceMode: "exclusive" | "inclusive" = net
    ? "exclusive"
    : line.priceMode === "exclusive"
      ? "exclusive"
      : "inclusive";

  const otherSupplier = Boolean(
    supplierId &&
      !supplierLine &&
      line.supplierId &&
      line.supplierId !== supplierId,
  );

  return {
    line,
    kind: supplierLine ? "supplier" : "any",
    otherSupplier,
    net,
    unitPrice,
    priceMode,
    taxCategory: nonEmpty(line.taxCategory),
    taxRegime: nonEmpty(line.taxRegime),
  };
}

export function formatLastPurchaseHintDate(
  purchasedAt: string,
  now: Date = new Date(),
): string {
  const date = new Date(purchasedAt);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  const month = HINT_MONTHS[date.getMonth()] ?? "";
  const dayMonth = `${date.getDate()} ${month}`;
  if (date.getFullYear() === now.getFullYear()) {
    return dayMonth;
  }
  return `${dayMonth} ${date.getFullYear()}`;
}

export function formatLastPurchaseHint(
  source: LastPurchaseSource,
  unit: string,
  now: Date = new Date(),
): string {
  const unitLabel = unit.trim() || "unit";
  const supplier = source.line.supplierName?.trim() || "Unknown supplier";
  const dateLabel = formatLastPurchaseHintDate(source.line.purchasedAt, now);
  const price = `${formatMoney(source.unitPrice)} / ${unitLabel}`;
  const who = source.otherSupplier
    ? `other supplier: ${supplier}`
    : supplier;
  let text = `last: ${price} · ${dateLabel} · ${who}`;
  if (source.net) {
    text += " · net";
  }
  return text;
}

function nonEmpty(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function canAutoWrite(
  field: keyof PrefillTouchState,
  input: AutomaticPrefillInput,
): boolean {
  if (input.readOnly || input.touched[field]) {
    return false;
  }
  if (
    !input.loadedFromDatabase ||
    input.ingredientChanged ||
    input.helperOwned[field]
  ) {
    return true;
  }
  return false;
}

/** Fields automatic prefill may copy. Null when this line must be left alone. */
export function planAutomaticPrefill(
  source: LastPurchaseSource | null,
  input: AutomaticPrefillInput,
): LastPurchaseFieldPatch | null {
  if (!source || input.readOnly) {
    return null;
  }

  const patch: LastPurchaseFieldPatch = {};
  if (canAutoWrite("unitCost", input)) {
    patch.unitPrice = source.unitPrice;
  }
  if (canAutoWrite("priceMode", input)) {
    patch.priceMode = source.priceMode;
  }
  if (canAutoWrite("taxCategory", input) && source.taxCategory) {
    patch.taxCategory = source.taxCategory;
  }
  if (canAutoWrite("taxRegime", input) && source.taxRegime) {
    patch.taxRegime = source.taxRegime;
  }

  if (
    patch.unitPrice === undefined &&
    patch.priceMode === undefined &&
    patch.taxCategory === undefined &&
    patch.taxRegime === undefined
  ) {
    return null;
  }

  return patch;
}

/**
 * Explicit Use click. Copies price, price mode, and tax identity even when
 * the line was loaded or the user had typed in those fields.
 */
export function planUseLastPurchase(
  source: LastPurchaseSource | null,
): LastPurchaseFieldPatch | null {
  if (!source) {
    return null;
  }

  return {
    unitPrice: source.unitPrice,
    priceMode: source.priceMode,
    ...(source.taxCategory ? { taxCategory: source.taxCategory } : {}),
    ...(source.taxRegime ? { taxRegime: source.taxRegime } : {}),
  };
}

export interface FillLastPricesLine {
  unitPrice: string;
  source: LastPurchaseSource | null;
  touched: PrefillTouchState;
}

export interface FillLastPricesPlan {
  filled: number;
  candidates: number;
  patches: Array<LastPurchaseFieldPatch | null>;
}

/**
 * Document button. Only lines whose unit price is empty or 0 are candidates.
 * A non-zero price is never changed. Touched tax fields on a zero-price line
 * stay as the user left them.
 */
export function planFillLastPrices(
  lines: readonly FillLastPricesLine[],
  readOnly: boolean,
): FillLastPricesPlan {
  const patches: Array<LastPurchaseFieldPatch | null> = [];
  let candidates = 0;
  let filled = 0;

  for (const line of lines) {
    if (readOnly || !isEmptyOrZeroUnitPrice(line.unitPrice)) {
      patches.push(null);
      continue;
    }

    candidates += 1;
    if (!line.source) {
      patches.push(null);
      continue;
    }

    const patch: LastPurchaseFieldPatch = {
      unitPrice: line.source.unitPrice,
    };
    if (!line.touched.priceMode) {
      patch.priceMode = line.source.priceMode;
    }
    if (!line.touched.taxCategory && line.source.taxCategory) {
      patch.taxCategory = line.source.taxCategory;
    }
    if (!line.touched.taxRegime && line.source.taxRegime) {
      patch.taxRegime = line.source.taxRegime;
    }
    patches.push(patch);
    filled += 1;
  }

  return { filled, candidates, patches };
}

export function fillLastPricesNote(filled: number, candidates: number): string {
  return `Filled ${filled} of ${candidates} lines`;
}
