/**
 * Daily Sales Summary service (DEV-114).
 *
 * Reads the immutable commercial snapshot of a closed Shift. The snapshot
 * is written by close_shift (sql/142) in the same transaction that closes
 * the shift — the browser never writes it.
 */

import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import type { DailySalesSummary } from "../types/daily-sales-summary";

export interface DailySalesSummaryRow {
  id: string;
  shift_id: string;
  sales_count: number | string;
  items_sold: number | string;
  gross_revenue: number | string;
  net_revenue: number | string;
  average_receipt: number | string;
  generated_at: string;
  created_at: string;
}

const SUMMARY_SELECT =
  "id, shift_id, sales_count, items_sold, gross_revenue, net_revenue, average_receipt, generated_at, created_at";

function toNumber(value: number | string): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
}

export function mapDailySalesSummary(
  row: DailySalesSummaryRow,
): DailySalesSummary | null {
  const sales_count = toNumber(row.sales_count);
  const items_sold = toNumber(row.items_sold);
  const gross_revenue = toNumber(row.gross_revenue);
  const net_revenue = toNumber(row.net_revenue);
  const average_receipt = toNumber(row.average_receipt);

  if (
    sales_count === null ||
    items_sold === null ||
    gross_revenue === null ||
    net_revenue === null ||
    average_receipt === null
  ) {
    return null;
  }

  return {
    id: row.id,
    shift_id: row.shift_id,
    sales_count,
    items_sold,
    gross_revenue,
    net_revenue,
    average_receipt,
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
        normalized.includes("shift_daily_sales_summaries") &&
        (normalized.includes("does not exist") ||
          normalized.includes("schema cache") ||
          normalized.includes("42p01"))
      ) {
        return "Daily sales summary is not available yet. Apply the daily sales summary database script and try again.";
      }

      return null;
    },
  });
}

export const dailySalesSummaryService = {
  async getSummaryForShift(
    shiftId: string,
  ): Promise<ServiceResult<DailySalesSummary | null>> {
    try {
      const trimmed = shiftId.trim();
      if (!trimmed) {
        return fail("Shift id is required.");
      }

      const { data, error } = await supabase
        .from("shift_daily_sales_summaries")
        .select(SUMMARY_SELECT)
        .eq("shift_id", trimmed)
        .maybeSingle();

      if (error) {
        return fail(mapSummaryError(error, "Failed to load daily sales summary"));
      }

      if (!data) {
        return ok(null);
      }

      const mapped = mapDailySalesSummary(data as DailySalesSummaryRow);
      if (!mapped) {
        return fail("Daily sales summary data is invalid.");
      }

      return ok(mapped);
    } catch (error) {
      return fail(mapSummaryError(error, "Failed to load daily sales summary"));
    }
  },
};
