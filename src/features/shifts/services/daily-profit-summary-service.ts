/**
 * Daily Profit Summary service (DEV-115).
 *
 * Generates an immutable profit snapshot once when a Shift closes.
 * Reuses frozen Sale Profit summaries (DEV-110) — never recalculates COGS/VAT.
 */

import { saleProfitService } from "@/features/sales/services/sale-profit-service";
import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import type { Shift } from "../types/shift";
import type {
  DailyProfitSaleFact,
  DailyProfitSummary,
  GenerateDailyProfitSummaryResult,
} from "../types/daily-profit-summary";
import {
  assertCanGenerateDailyProfitSummary,
  assertDailyProfitSummaryHistoricallyImmutable,
  assertDailyProfitSummaryNotDuplicate,
  buildDailyProfitSummary,
} from "../utils/daily-profit-summary-builder";

interface DailyProfitSummaryRow {
  id: string;
  shift_id: string;
  net_revenue: number | string;
  total_cogs: number | string;
  gross_profit: number | string;
  gross_margin_percent: number | string | null;
  generated_at: string;
  created_at: string;
}

interface SaleHeaderRow {
  id: string;
  status: string;
  confirmed_at: string | null;
}

const SUMMARY_SELECT =
  "id, shift_id, net_revenue, total_cogs, gross_profit, gross_margin_percent, generated_at, created_at";

function toNumber(value: number | string): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
}

function mapSummary(row: DailyProfitSummaryRow): DailyProfitSummary | null {
  const net_revenue = toNumber(row.net_revenue);
  const total_cogs = toNumber(row.total_cogs);
  const gross_profit = toNumber(row.gross_profit);

  if (net_revenue === null || total_cogs === null || gross_profit === null) {
    return null;
  }

  let gross_margin_percent: number | null = null;
  if (row.gross_margin_percent !== null && row.gross_margin_percent !== undefined) {
    const margin = toNumber(row.gross_margin_percent);
    if (margin === null) {
      return null;
    }
    gross_margin_percent = margin;
  }

  if (net_revenue === 0 && gross_margin_percent !== null) {
    return null;
  }
  if (net_revenue > 0 && gross_margin_percent === null) {
    return null;
  }

  return {
    id: row.id,
    shift_id: row.shift_id,
    net_revenue,
    total_cogs,
    gross_profit,
    gross_margin_percent,
    generated_at: row.generated_at,
    created_at: row.created_at,
  };
}

function mapSummaryError(error: unknown, fallback: string): string {
  return toUserError(error, fallback, {
    map: (err) => {
      const message =
        typeof err === "object" &&
        err !== null &&
        "message" in err &&
        typeof (err as { message: unknown }).message === "string"
          ? (err as { message: string }).message
          : typeof err === "string"
            ? err
            : null;

      if (!message) {
        return null;
      }

      const normalized = message.toLowerCase();

      if (
        normalized.includes("shift_daily_profit_summaries_shift_uidx") ||
        (normalized.includes("duplicate") &&
          normalized.includes("shift_daily_profit_summaries"))
      ) {
        return "This shift already has a daily profit summary.";
      }

      if (
        normalized.includes("shift_daily_profit_summaries") &&
        (normalized.includes("does not exist") ||
          normalized.includes("schema cache") ||
          normalized.includes("42p01"))
      ) {
        return "Daily profit summary is not available yet. Apply the daily profit summary database script and try again.";
      }

      return null;
    },
  });
}

/**
 * Completed sales confirmed during the shift window (ids only).
 */
async function loadCompletedSaleIdsForShift(
  shift: Shift,
): Promise<ServiceResult<string[]>> {
  if (!shift.closed_at) {
    return fail("Closed shift is missing closed_at.");
  }

  const { data, error } = await supabase
    .from("sales")
    .select("id, status, confirmed_at")
    .in("status", ["confirmed", "paid"])
    .not("confirmed_at", "is", null)
    .gte("confirmed_at", shift.opened_at)
    .lte("confirmed_at", shift.closed_at);

  if (error) {
    return fail(mapSummaryError(error, "Failed to load shift sales"));
  }

  const ids = ((data ?? []) as SaleHeaderRow[]).map((row) => row.id);
  return ok(ids);
}

/**
 * Load frozen sale-profit facts via DEV-110 service (no Sales module changes).
 */
async function loadFrozenSaleProfitFacts(
  saleIds: string[],
): Promise<ServiceResult<DailyProfitSaleFact[]>> {
  const facts: DailyProfitSaleFact[] = [];

  for (const saleId of saleIds) {
    const profitResult = await saleProfitService.getSaleProfitSummary(saleId);
    if (profitResult.error || !profitResult.data) {
      return fail(
        profitResult.error ??
          "Failed to load frozen sale profit for daily summary",
      );
    }

    const profit = profitResult.data;
    facts.push({
      sale_id: profit.sale_id,
      net_revenue: profit.net_revenue,
      cogs: profit.cogs,
      gross_profit: profit.gross_profit,
    });
  }

  return ok(facts);
}

export const dailyProfitSummaryService = {
  buildDailyProfitSummary,
  assertCanGenerateDailyProfitSummary,
  assertDailyProfitSummaryNotDuplicate,
  assertDailyProfitSummaryHistoricallyImmutable,

  async getSummaryForShift(
    shiftId: string,
  ): Promise<ServiceResult<DailyProfitSummary | null>> {
    try {
      const trimmed = shiftId.trim();
      if (!trimmed) {
        return fail("Shift id is required.");
      }

      const { data, error } = await supabase
        .from("shift_daily_profit_summaries")
        .select(SUMMARY_SELECT)
        .eq("shift_id", trimmed)
        .maybeSingle();

      if (error) {
        return fail(
          mapSummaryError(error, "Failed to load daily profit summary"),
        );
      }

      if (!data) {
        return ok(null);
      }

      const mapped = mapSummary(data as DailyProfitSummaryRow);
      if (!mapped) {
        return fail("Daily profit summary data is invalid.");
      }

      return ok(mapped);
    } catch (error) {
      return fail(
        mapSummaryError(error, "Failed to load daily profit summary"),
      );
    }
  },

  /**
   * Generate and persist the immutable profit summary for a closed shift.
   * Empty / no completed sales still stores a zero summary (null margin).
   */
  async generateForClosedShift(
    shift: Shift,
  ): Promise<ServiceResult<GenerateDailyProfitSummaryResult>> {
    try {
      const shiftGuard = assertCanGenerateDailyProfitSummary(shift);
      if (shiftGuard) {
        return fail(shiftGuard);
      }

      const existingResult = await this.getSummaryForShift(shift.id);
      if (existingResult.error) {
        return fail(existingResult.error);
      }

      const duplicateGuard = assertDailyProfitSummaryNotDuplicate(
        existingResult.data,
      );
      if (duplicateGuard) {
        return fail(duplicateGuard);
      }

      const saleIdsResult = await loadCompletedSaleIdsForShift(shift);
      if (saleIdsResult.error || !saleIdsResult.data) {
        return fail(saleIdsResult.error ?? "Failed to load shift sales");
      }

      const factsResult = await loadFrozenSaleProfitFacts(saleIdsResult.data);
      if (factsResult.error || !factsResult.data) {
        return fail(
          factsResult.error ?? "Failed to load frozen sale profits",
        );
      }

      const built = buildDailyProfitSummary({
        shift_id: shift.id,
        sale_profits: factsResult.data,
      });

      if (built.error || !built.data) {
        return fail(built.error ?? "Failed to build daily profit summary");
      }

      const { data, error } = await supabase
        .from("shift_daily_profit_summaries")
        .insert({
          shift_id: built.data.shift_id,
          net_revenue: built.data.net_revenue,
          total_cogs: built.data.total_cogs,
          gross_profit: built.data.gross_profit,
          gross_margin_percent: built.data.gross_margin_percent,
        })
        .select(SUMMARY_SELECT)
        .single();

      if (error) {
        return fail(
          mapSummaryError(error, "Failed to save daily profit summary"),
        );
      }

      const mapped = mapSummary(data as DailyProfitSummaryRow);
      if (!mapped) {
        return fail("Daily profit summary saved but the response was invalid.");
      }

      if (
        mapped.shift_id !== built.data.shift_id ||
        mapped.net_revenue !== built.data.net_revenue ||
        mapped.total_cogs !== built.data.total_cogs ||
        mapped.gross_profit !== built.data.gross_profit ||
        mapped.gross_margin_percent !== built.data.gross_margin_percent
      ) {
        return fail("Daily profit summaries are immutable historical records.");
      }

      return ok({ summary: mapped });
    } catch (error) {
      return fail(
        mapSummaryError(error, "Failed to save daily profit summary"),
      );
    }
  },
};
