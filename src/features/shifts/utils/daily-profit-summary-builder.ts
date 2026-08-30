/**
 * Daily Profit Summary pure builder (DEV-115).
 *
 * Aggregates unrounded per-sale ledger facts into a shift snapshot:
 * sum raw revenue and COGS, then round once (sql/092). Never
 * recalculates historical stored summaries or invents COGS/revenue.
 */

import { roundMoney } from "@/lib/money";
import type { Shift } from "../types/shift";
import type {
  BuildDailyProfitSummaryInput,
  BuildDailyProfitSummaryResult,
  DailyProfitSaleFact,
  DailyProfitSummary,
} from "../types/daily-profit-summary";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MARGIN_DECIMAL_PLACES = 2;

function roundMarginPercent(value: number): number {
  const factor = 10 ** MARGIN_DECIMAL_PLACES;
  return Math.round(value * factor) / factor;
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

export function validateDailyProfitSaleFact(
  fact: DailyProfitSaleFact,
): string | null {
  if (!fact.sale_id || !UUID_RE.test(fact.sale_id)) {
    return "Sale id is required.";
  }
  if (!Number.isFinite(fact.net_revenue) || fact.net_revenue < 0) {
    return "Sale net revenue must be a non-negative amount.";
  }
  if (!Number.isFinite(fact.cogs) || fact.cogs < 0) {
    return "Sale COGS must be a non-negative amount.";
  }

  return null;
}

export function assertCanGenerateDailyProfitSummary(
  shift: Shift | null,
): string | null {
  if (!shift) {
    return "Shift was not found.";
  }
  if (shift.status === "open") {
    return "Close the shift before generating the daily profit summary.";
  }
  if (shift.status !== "closed") {
    return "Only a closed shift can have a daily profit summary.";
  }
  if (!shift.closed_at) {
    return "Closed shift is missing closed_at.";
  }
  return null;
}

export function assertDailyProfitSummaryNotDuplicate(
  existing: DailyProfitSummary | null,
): string | null {
  if (existing) {
    return "This shift already has a daily profit summary.";
  }
  return null;
}

export function assertDailyProfitSummaryHistoricallyImmutable(input: {
  previous: DailyProfitSummary;
  next: DailyProfitSummary;
}): string | null {
  const { previous, next } = input;

  if (
    previous.id !== next.id ||
    previous.shift_id !== next.shift_id ||
    previous.net_revenue !== next.net_revenue ||
    previous.total_cogs !== next.total_cogs ||
    previous.gross_profit !== next.gross_profit ||
    previous.gross_margin_percent !== next.gross_margin_percent ||
    previous.generated_at !== next.generated_at ||
    previous.created_at !== next.created_at
  ) {
    return "Daily profit summaries are immutable historical records.";
  }

  return null;
}

/**
 * Build a frozen daily profit summary from unrounded per-sale ledger facts.
 * Sums raw revenue and COGS across the shift, then rounds each total once
 * (mirrors verify_daily_profit_summary / sql/092). Empty sales → zeros
 * with null margin.
 */
export function buildDailyProfitSummary(
  input: BuildDailyProfitSummaryInput,
): { data: BuildDailyProfitSummaryResult | null; error: string | null } {
  if (!input.shift_id || !UUID_RE.test(input.shift_id.trim())) {
    return { data: null, error: "Shift id is required." };
  }

  const shiftId = input.shift_id.trim();

  if (hasExistingShiftId(shiftId, input.existing_shift_ids)) {
    return {
      data: null,
      error: "This shift already has a daily profit summary.",
    };
  }

  for (const fact of input.sale_profits) {
    const factError = validateDailyProfitSaleFact(fact);
    if (factError) {
      return { data: null, error: factError };
    }
  }

  let raw_net_revenue = 0;
  let raw_total_cogs = 0;

  for (const fact of input.sale_profits) {
    raw_net_revenue += fact.net_revenue;
    raw_total_cogs += fact.cogs;
  }

  const net_revenue = roundMoney(raw_net_revenue);
  const total_cogs = roundMoney(raw_total_cogs);
  const gross_profit = roundMoney(net_revenue - total_cogs);
  const gross_margin_percent =
    net_revenue === 0
      ? null
      : roundMarginPercent((gross_profit / net_revenue) * 100);

  return {
    data: {
      shift_id: shiftId,
      net_revenue,
      total_cogs,
      gross_profit,
      gross_margin_percent,
      is_frozen: true,
    },
    error: null,
  };
}
