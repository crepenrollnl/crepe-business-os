/**
 * BTW Report read service (sql/095).
 *
 * Reads exclusively via get_btw_report RPC. Does not persist, cache, or
 * recalculate VAT — the RPC always recomputes from posted journal_lines.
 */

import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import type { BtwBalanceDirection, BtwReport } from "../types/btw-report";

function toNumber(value: unknown, label: string): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  throw new Error(`${label} is invalid.`);
}

function toNonEmptyString(value: unknown, label: string): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  throw new Error(`${label} is invalid.`);
}

function toBalanceDirection(value: unknown): BtwBalanceDirection {
  if (value === "to_pay" || value === "to_receive" || value === "zero") {
    return value;
  }
  throw new Error("BTW balance direction is invalid.");
}

function mapBtwReport(payload: unknown): BtwReport {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new Error("BTW report payload is invalid.");
  }

  const row = payload as Record<string, unknown>;

  return {
    year: toNumber(row.year, "Year"),
    quarter: toNumber(row.quarter, "Quarter"),
    period_start: toNonEmptyString(row.period_start, "Period start"),
    period_end: toNonEmptyString(row.period_end, "Period end"),
    rubriek_1a_revenue: toNumber(row.rubriek_1a_revenue, "Rubriek 1a revenue"),
    rubriek_1a_vat: toNumber(row.rubriek_1a_vat, "Rubriek 1a VAT"),
    rubriek_1b_revenue: toNumber(row.rubriek_1b_revenue, "Rubriek 1b revenue"),
    rubriek_1b_vat: toNumber(row.rubriek_1b_vat, "Rubriek 1b VAT"),
    rubriek_5a_total_vat_due: toNumber(
      row.rubriek_5a_total_vat_due,
      "Rubriek 5a",
    ),
    rubriek_5b_input_vat_deductible: toNumber(
      row.rubriek_5b_input_vat_deductible,
      "Rubriek 5b",
    ),
    rubriek_5c_balance: toNumber(row.rubriek_5c_balance, "Rubriek 5c"),
    balance_direction: toBalanceDirection(row.balance_direction),
  };
}

export const btwReportService = {
  async getBtwReport(
    year: number,
    quarter: number,
  ): Promise<ServiceResult<BtwReport>> {
    try {
      const { data, error } = await supabase.rpc("get_btw_report", {
        p_year: year,
        p_quarter: quarter,
      });

      if (error || data == null) {
        return fail(toUserError(error, "Failed to load BTW report."));
      }

      return ok(mapBtwReport(data));
    } catch (error) {
      return fail(toUserError(error, "Failed to load BTW report."));
    }
  },
};
