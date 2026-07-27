/**
 * Daily Sales Summary service (DEV-114).
 *
 * Generates an immutable commercial snapshot once when a Shift closes.
 * Reads completed Sales in the shift window — does not change Sales module.
 */

import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import type { Shift } from "../types/shift";
import type {
  DailySalesSaleFact,
  DailySalesSummary,
  GenerateDailySalesSummaryResult,
} from "../types/daily-sales-summary";
import {
  assertCanGenerateDailySalesSummary,
  assertDailySalesSummaryHistoricallyImmutable,
  assertDailySalesSummaryNotDuplicate,
  buildDailySalesSummary,
  isCompletedSaleStatus,
} from "../utils/daily-sales-summary-builder";

interface DailySalesSummaryRow {
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

interface SaleHeaderRow {
  id: string;
  status: string;
  subtotal: number | string;
  total: number | string;
  confirmed_at: string | null;
}

interface SaleLineQtyRow {
  sale_id: string;
  quantity: number | string;
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

function mapSummary(row: DailySalesSummaryRow): DailySalesSummary | null {
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
        normalized.includes("shift_daily_sales_summaries_shift_uidx") ||
        (normalized.includes("duplicate") &&
          normalized.includes("shift_daily_sales_summaries"))
      ) {
        return "This shift already has a daily sales summary.";
      }

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

/**
 * Load completed sales confirmed during the shift window and line quantities.
 */
async function loadCompletedSaleFactsForShift(
  shift: Shift,
): Promise<ServiceResult<DailySalesSaleFact[]>> {
  if (!shift.closed_at) {
    return fail("Closed shift is missing closed_at.");
  }

  const { data: salesRows, error: salesError } = await supabase
    .from("sales")
    .select("id, status, subtotal, total, confirmed_at")
    .in("status", ["confirmed", "paid"])
    .not("confirmed_at", "is", null)
    .gte("confirmed_at", shift.opened_at)
    .lte("confirmed_at", shift.closed_at);

  if (salesError) {
    return fail(mapSummaryError(salesError, "Failed to load shift sales"));
  }

  const headers = (salesRows ?? []) as SaleHeaderRow[];
  if (headers.length === 0) {
    return ok([]);
  }

  const saleIds = headers.map((row) => row.id);

  const { data: lineRows, error: linesError } = await supabase
    .from("sale_lines")
    .select("sale_id, quantity")
    .in("sale_id", saleIds);

  if (linesError) {
    return fail(mapSummaryError(linesError, "Failed to load sale lines"));
  }

  const itemsBySale = new Map<string, number>();
  for (const line of (lineRows ?? []) as SaleLineQtyRow[]) {
    const qty = toNumber(line.quantity);
    if (qty === null) {
      return fail("Sale line quantity is invalid.");
    }
    itemsBySale.set(line.sale_id, (itemsBySale.get(line.sale_id) ?? 0) + qty);
  }

  const facts: DailySalesSaleFact[] = [];

  for (const row of headers) {
    if (!isCompletedSaleStatus(row.status)) {
      continue;
    }

    const subtotal = toNumber(row.subtotal);
    const total = toNumber(row.total);
    if (subtotal === null || total === null) {
      return fail("Sale commercial totals are invalid.");
    }

    facts.push({
      id: row.id,
      status: row.status,
      subtotal,
      total,
      items_sold: Math.round((itemsBySale.get(row.id) ?? 0) * 1000) / 1000,
    });
  }

  return ok(facts);
}

export const dailySalesSummaryService = {
  buildDailySalesSummary,
  assertCanGenerateDailySalesSummary,
  assertDailySalesSummaryNotDuplicate,
  assertDailySalesSummaryHistoricallyImmutable,

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

      const mapped = mapSummary(data as DailySalesSummaryRow);
      if (!mapped) {
        return fail("Daily sales summary data is invalid.");
      }

      return ok(mapped);
    } catch (error) {
      return fail(mapSummaryError(error, "Failed to load daily sales summary"));
    }
  },

  /**
   * Generate and persist the immutable summary for a closed shift.
   * Empty / no completed sales still stores a zero summary.
   */
  async generateForClosedShift(
    shift: Shift,
  ): Promise<ServiceResult<GenerateDailySalesSummaryResult>> {
    try {
      const shiftGuard = assertCanGenerateDailySalesSummary(shift);
      if (shiftGuard) {
        return fail(shiftGuard);
      }

      const existingResult = await this.getSummaryForShift(shift.id);
      if (existingResult.error) {
        return fail(existingResult.error);
      }

      const duplicateGuard = assertDailySalesSummaryNotDuplicate(
        existingResult.data,
      );
      if (duplicateGuard) {
        return fail(duplicateGuard);
      }

      const factsResult = await loadCompletedSaleFactsForShift(shift);
      if (factsResult.error || !factsResult.data) {
        return fail(factsResult.error ?? "Failed to load shift sales");
      }

      const built = buildDailySalesSummary({
        shift_id: shift.id,
        sales: factsResult.data,
      });

      if (built.error || !built.data) {
        return fail(built.error ?? "Failed to build daily sales summary");
      }

      const { data, error } = await supabase
        .from("shift_daily_sales_summaries")
        .insert({
          shift_id: built.data.shift_id,
          sales_count: built.data.sales_count,
          items_sold: built.data.items_sold,
          gross_revenue: built.data.gross_revenue,
          net_revenue: built.data.net_revenue,
          average_receipt: built.data.average_receipt,
        })
        .select(SUMMARY_SELECT)
        .single();

      if (error) {
        return fail(
          mapSummaryError(error, "Failed to save daily sales summary"),
        );
      }

      const mapped = mapSummary(data as DailySalesSummaryRow);
      if (!mapped) {
        return fail("Daily sales summary saved but the response was invalid.");
      }

      if (
        mapped.shift_id !== built.data.shift_id ||
        mapped.sales_count !== built.data.sales_count ||
        mapped.items_sold !== built.data.items_sold ||
        mapped.gross_revenue !== built.data.gross_revenue ||
        mapped.net_revenue !== built.data.net_revenue ||
        mapped.average_receipt !== built.data.average_receipt
      ) {
        return fail("Daily sales summaries are immutable historical records.");
      }

      return ok({ summary: mapped });
    } catch (error) {
      return fail(
        mapSummaryError(error, "Failed to save daily sales summary"),
      );
    }
  },
};
