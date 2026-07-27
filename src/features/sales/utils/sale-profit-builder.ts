/**
 * Sales Profit builder (DEV-110).
 *
 * Builds an immutable sale profit summary from stored net revenue (ex-VAT)
 * and frozen COGS. Never recalculates VAT or COGS.
 *
 * Profit = Net Revenue − Frozen COGS
 * Margin % = (Gross Profit / Net Revenue) × 100 when revenue > 0
 */

import { roundMoney } from "@/lib/money";
import type {
  SaleProfitBuilderInput,
  SaleProfitSummary,
} from "../types/sale-profit";

const MARGIN_DECIMAL_PLACES = 2;

function roundMarginPercent(value: number): number {
  const factor = 10 ** MARGIN_DECIMAL_PLACES;
  return Math.round(value * factor) / factor;
}

/**
 * Reject regenerating a second profit snapshot for the same sale.
 */
export function assertUniqueSaleProfitGeneration(
  saleId: string,
  alreadyBuiltSaleIds: readonly string[],
): string | null {
  const trimmed = saleId?.trim() ?? "";
  if (!trimmed) {
    return "Sale id is required.";
  }

  if (alreadyBuiltSaleIds.includes(trimmed)) {
    return "Sale profit has already been generated for this sale.";
  }

  return null;
}

/**
 * Build frozen sale profit from stored net revenue and frozen COGS.
 */
export function buildSaleProfitSummary(
  input: SaleProfitBuilderInput,
):
  | { ok: true; summary: SaleProfitSummary }
  | { ok: false; error: string } {
  const saleId = input.sale_id?.trim() ?? "";
  if (!saleId) {
    return { ok: false, error: "Sale id is required." };
  }

  const duplicateError = assertUniqueSaleProfitGeneration(
    saleId,
    input.alreadyBuiltSaleIds ?? [],
  );
  if (duplicateError) {
    return { ok: false, error: duplicateError };
  }

  if (input.sale_status === "draft") {
    return {
      ok: false,
      error: "Draft sales do not have frozen profit yet.",
    };
  }

  if (input.sale_status === "cancelled") {
    return {
      ok: false,
      error: "Cancelled sales do not have frozen profit.",
    };
  }

  const netRevenue = Number(input.net_revenue);
  const cogs = Number(input.cogs);

  if (!Number.isFinite(netRevenue) || netRevenue < 0) {
    return { ok: false, error: "Sale net revenue is invalid for profit." };
  }

  if (!Number.isFinite(cogs) || cogs < 0) {
    return { ok: false, error: "Sale COGS is invalid for profit." };
  }

  const grossProfit = roundMoney(netRevenue - cogs);
  const grossMarginPercent =
    netRevenue === 0
      ? null
      : roundMarginPercent((grossProfit / netRevenue) * 100);

  return {
    ok: true,
    summary: {
      sale_id: saleId,
      net_revenue: roundMoney(netRevenue),
      cogs: roundMoney(cogs),
      gross_profit: grossProfit,
      gross_margin_percent: grossMarginPercent,
      is_frozen: true,
    },
  };
}

/**
 * Assert historical profit immutability: frozen figures must not change.
 */
export function assertSaleProfitImmutable(input: {
  previous: SaleProfitSummary;
  next: SaleProfitSummary;
}): string | null {
  if (input.previous.sale_id !== input.next.sale_id) {
    return "Sale profit sale id is immutable.";
  }

  if (
    input.previous.net_revenue !== input.next.net_revenue ||
    input.previous.cogs !== input.next.cogs ||
    input.previous.gross_profit !== input.next.gross_profit ||
    input.previous.gross_margin_percent !== input.next.gross_margin_percent
  ) {
    return "Sale profit is immutable after completion.";
  }

  return null;
}
