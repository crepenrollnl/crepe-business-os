/**
 * Daily Sales Summary pure builder (DEV-114).
 *
 * Aggregates completed-sale facts into a frozen shift snapshot.
 * Never recalculates historical stored summaries.
 */

import { roundMoney } from "@/lib/money";
import type { Shift } from "../types/shift";
import type {
  BuildDailySalesSummaryInput,
  BuildDailySalesSummaryResult,
  DailySalesSaleFact,
  DailySalesSummary,
} from "../types/daily-sales-summary";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function toNumber(value: number): number {
  return Number.isFinite(value) ? value : NaN;
}

/**
 * Neither `instanceof Set` nor the bare `Array.isArray(existing)` narrows
 * both branches of `ReadonlySet<string> | readonly string[]`: each built-in
 * guard is declared against a *mutable* type (`Set<any>` / `any[]`), and
 * neither readonly interface is assignable to its mutable counterpart, so
 * TS can't exclude it from the other branch. A user-defined predicate
 * sidesteps that and narrows correctly both ways.
 */
function isReadonlyArray<T>(
  value: ReadonlySet<T> | readonly T[],
): value is readonly T[] {
  return Array.isArray(value);
}

function hasExistingShiftId(
  shiftId: string,
  existing?: ReadonlySet<string> | readonly string[],
): boolean {
  if (!existing) {
    return false;
  }
  if (isReadonlyArray(existing)) {
    return existing.includes(shiftId);
  }
  return existing.has(shiftId);
}

export function isCompletedSaleStatus(
  status: string,
): status is DailySalesSaleFact["status"] {
  return status === "confirmed" || status === "paid";
}

export function validateDailySalesSaleFact(
  sale: DailySalesSaleFact,
): string | null {
  if (!sale.id || !UUID_RE.test(sale.id)) {
    return "Sale id is required.";
  }
  if (!isCompletedSaleStatus(sale.status)) {
    return "Only completed sales can be included in the daily summary.";
  }
  if (!Number.isFinite(sale.subtotal) || sale.subtotal < 0) {
    return "Sale net revenue must be a non-negative amount.";
  }
  if (!Number.isFinite(sale.total) || sale.total < 0) {
    return "Sale gross revenue must be a non-negative amount.";
  }
  if (!Number.isFinite(sale.items_sold) || sale.items_sold < 0) {
    return "Sale items sold must be a non-negative quantity.";
  }
  return null;
}

/**
 * Reject generating a summary for an active (open) shift.
 */
export function assertCanGenerateDailySalesSummary(
  shift: Shift | null,
): string | null {
  if (!shift) {
    return "Shift was not found.";
  }
  if (shift.status === "open") {
    return "Close the shift before generating the daily sales summary.";
  }
  if (shift.status !== "closed") {
    return "Only a closed shift can have a daily sales summary.";
  }
  if (!shift.closed_at) {
    return "Closed shift is missing closed_at.";
  }
  return null;
}

export function assertDailySalesSummaryNotDuplicate(
  existing: DailySalesSummary | null,
): string | null {
  if (existing) {
    return "This shift already has a daily sales summary.";
  }
  return null;
}

export function assertDailySalesSummaryHistoricallyImmutable(input: {
  previous: DailySalesSummary;
  next: DailySalesSummary;
}): string | null {
  const { previous, next } = input;

  if (
    previous.id !== next.id ||
    previous.shift_id !== next.shift_id ||
    previous.sales_count !== next.sales_count ||
    previous.items_sold !== next.items_sold ||
    previous.gross_revenue !== next.gross_revenue ||
    previous.net_revenue !== next.net_revenue ||
    previous.average_receipt !== next.average_receipt ||
    previous.generated_at !== next.generated_at ||
    previous.created_at !== next.created_at
  ) {
    return "Daily sales summaries are immutable historical records.";
  }

  return null;
}

/**
 * Build a frozen daily sales summary from completed-sale facts.
 * Empty / no completed sales → zeros (valid empty shift).
 */
export function buildDailySalesSummary(
  input: BuildDailySalesSummaryInput,
): { data: BuildDailySalesSummaryResult | null; error: string | null } {
  if (!input.shift_id || !UUID_RE.test(input.shift_id.trim())) {
    return { data: null, error: "Shift id is required." };
  }

  const shiftId = input.shift_id.trim();

  if (hasExistingShiftId(shiftId, input.existing_shift_ids)) {
    return {
      data: null,
      error: "This shift already has a daily sales summary.",
    };
  }

  for (const sale of input.sales) {
    const saleError = validateDailySalesSaleFact(sale);
    if (saleError) {
      return { data: null, error: saleError };
    }
  }

  let sales_count = 0;
  let items_sold = 0;
  let gross_revenue = 0;
  let net_revenue = 0;

  for (const sale of input.sales) {
    sales_count += 1;
    items_sold += toNumber(sale.items_sold);
    gross_revenue = roundMoney(gross_revenue + toNumber(sale.total));
    net_revenue = roundMoney(net_revenue + toNumber(sale.subtotal));
  }

  // Keep item totals to 3 decimal places (sale_lines.quantity precision).
  items_sold = Math.round(items_sold * 1000) / 1000;

  const average_receipt =
    sales_count > 0 ? roundMoney(gross_revenue / sales_count) : 0;

  return {
    data: {
      shift_id: shiftId,
      sales_count,
      items_sold,
      gross_revenue,
      net_revenue,
      average_receipt,
      is_frozen: true,
    },
    error: null,
  };
}
