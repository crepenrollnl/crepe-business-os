/**
 * Daily Profit Summary service (DEV-115).
 *
 * Reads the immutable profit snapshot of a closed Shift. The snapshot is
 * written by close_shift (sql/142) in the same transaction that closes the
 * shift, with the formulas of verify_daily_profit_summary (sql/092) — the
 * browser never writes it.
 */

import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import type { DailyProfitSummary } from "../types/daily-profit-summary";

export interface DailyProfitSummaryRow {
  id: string;
  shift_id: string;
  net_revenue: number | string;
  total_cogs: number | string;
  gross_profit: number | string;
  gross_margin_percent: number | string | null;
  generated_at: string;
  created_at: string;
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

export function mapDailyProfitSummary(
  row: DailyProfitSummaryRow,
): DailyProfitSummary | null {
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

export const dailyProfitSummaryService = {
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

      const mapped = mapDailyProfitSummary(data as DailyProfitSummaryRow);
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
};
