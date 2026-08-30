/**
 * Daily Profit Summary service (DEV-115).
 *
 * Generates an immutable profit snapshot once when a Shift closes.
 * Per-sale profit (DEV-110) is a completeness gate. Shift totals sum
 * raw sale.subtotal and raw COGS layers, then round once — the same
 * order as verify_daily_profit_summary (sql/092).
 */

import { saleCogsService } from "@/features/sales/services/sale-cogs-service";
import { saleProfitService } from "@/features/sales/services/sale-profit-service";
import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import type { Shift } from "../types/shift";
import type {
  BuildDailyProfitSummaryResult,
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
  subtotal: number | string;
}

interface CompletedShiftSale {
  id: string;
  subtotal: number;
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

/**
 * Server-side recomputation check for the JS-built summary. Rejects the
 * write if the independent SQL aggregate disagrees with the JS result.
 */
async function verifyDailyProfitSummary(
  built: BuildDailyProfitSummaryResult,
): Promise<ServiceResult<true>> {
  const { data, error } = await supabase.rpc("verify_daily_profit_summary", {
    p_shift_id: built.shift_id,
    p_net_revenue: built.net_revenue,
    p_total_cogs: built.total_cogs,
    p_gross_profit: built.gross_profit,
    p_gross_margin_percent: built.gross_margin_percent,
  });

  if (error) {
    return fail(
      mapSummaryError(error, "Failed to verify daily profit summary"),
    );
  }

  if (data !== true) {
    return fail(
      "Daily profit summary failed server-side verification and was not saved.",
    );
  }

  return ok(true);
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
 * Completed sales confirmed during the shift window (id + raw subtotal).
 */
async function loadCompletedSalesForShift(
  shift: Shift,
): Promise<ServiceResult<CompletedShiftSale[]>> {
  if (!shift.closed_at) {
    return fail("Closed shift is missing closed_at.");
  }

  const { data, error } = await supabase
    .from("sales")
    .select("id, status, confirmed_at, subtotal")
    .in("status", ["confirmed", "paid"])
    .not("confirmed_at", "is", null)
    .gte("confirmed_at", shift.opened_at)
    .lte("confirmed_at", shift.closed_at);

  if (error) {
    return fail(mapSummaryError(error, "Failed to load shift sales"));
  }

  const sales: CompletedShiftSale[] = [];
  for (const row of (data ?? []) as SaleHeaderRow[]) {
    const subtotal = toNumber(row.subtotal);
    if (subtotal === null || subtotal < 0) {
      return fail("Shift sale subtotal is invalid.");
    }
    sales.push({ id: row.id, subtotal });
  }
  return ok(sales);
}

function sumRawLayerCogs(
  layers: readonly { total_cost: number }[],
): number {
  return layers.reduce((sum, layer) => sum + layer.total_cost, 0);
}

/**
 * Gate each sale through DEV-110 profit (completed + COGS layers +
 * verify_sale_cost_and_profit). Shift facts use raw subtotal and raw
 * layer COGS — not the already-rounded per-sale profit totals.
 */
async function loadFrozenSaleProfitFacts(
  sales: readonly CompletedShiftSale[],
): Promise<ServiceResult<DailyProfitSaleFact[]>> {
  const facts: DailyProfitSaleFact[] = [];

  for (const sale of sales) {
    const profitResult = await saleProfitService.getSaleProfitSummary(sale.id);
    if (profitResult.error || !profitResult.data) {
      return fail(
        profitResult.error ??
          "Failed to load frozen sale profit for daily summary",
      );
    }

    const cogsResult = await saleCogsService.getSaleCostSummary(sale.id);
    if (cogsResult.error || !cogsResult.data) {
      return fail(
        cogsResult.error ?? "Failed to load sale COGS for daily summary",
      );
    }

    facts.push({
      sale_id: sale.id,
      net_revenue: sale.subtotal,
      cogs: sumRawLayerCogs(cogsResult.data.layers),
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

      const salesResult = await loadCompletedSalesForShift(shift);
      if (salesResult.error || !salesResult.data) {
        return fail(salesResult.error ?? "Failed to load shift sales");
      }

      const factsResult = await loadFrozenSaleProfitFacts(salesResult.data);
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

      const verified = await verifyDailyProfitSummary(built.data);
      if (verified.error) {
        return fail(verified.error);
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
