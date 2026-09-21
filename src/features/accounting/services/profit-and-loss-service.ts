/**
 * Profit and Loss read service (sql/121).
 *
 * Reads exclusively via get_profit_and_loss. Does not persist or
 * recalculate P&L amounts in TypeScript.
 */

import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import type {
  ProfitAndLossOpexLine,
  ProfitAndLossReconciliationLine,
  ProfitAndLossReport,
} from "../types/profit-and-loss";

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

function toBoolean(value: unknown, label: string): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  throw new Error(`${label} is invalid.`);
}

function mapReconciliationLine(
  payload: unknown,
  label: string,
): ProfitAndLossReconciliationLine {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new Error(`${label} is invalid.`);
  }
  const row = payload as Record<string, unknown>;
  return {
    operational_amount: toNumber(row.operational_amount, `${label} operational`),
    ledger_amount: toNumber(row.ledger_amount, `${label} ledger`),
    mismatch: toBoolean(row.mismatch, `${label} mismatch`),
  };
}

function mapOpexLine(payload: unknown): ProfitAndLossOpexLine {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new Error("Opex breakdown row is invalid.");
  }
  const row = payload as Record<string, unknown>;
  return {
    account_code: toNonEmptyString(row.account_code, "Opex account code"),
    account_name: toNonEmptyString(row.account_name, "Opex account name"),
    amount: toNumber(row.amount, "Opex amount"),
  };
}

function mapReport(payload: unknown): ProfitAndLossReport {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new Error("P&L report payload is invalid.");
  }

  const row = payload as Record<string, unknown>;
  const reconciliation = row.reconciliation;
  if (
    typeof reconciliation !== "object" ||
    reconciliation === null ||
    Array.isArray(reconciliation)
  ) {
    throw new Error("P&L reconciliation is invalid.");
  }
  const recon = reconciliation as Record<string, unknown>;

  const breakdown = row.opex_breakdown;
  if (!Array.isArray(breakdown)) {
    throw new Error("Opex breakdown is invalid.");
  }

  return {
    period_start: toNonEmptyString(row.period_start, "Period start"),
    period_end: toNonEmptyString(row.period_end, "Period end"),
    revenue: toNumber(row.revenue, "Revenue"),
    cogs: toNumber(row.cogs, "COGS"),
    gross_profit: toNumber(row.gross_profit, "Gross profit"),
    opex_breakdown: breakdown.map(mapOpexLine),
    opex: toNumber(row.opex, "Opex"),
    write_offs: toNumber(row.write_offs, "Write-offs"),
    depreciation: toNumber(row.depreciation, "Depreciation"),
    net_profit: toNumber(row.net_profit, "Net profit"),
    reconciliation: {
      sales_revenue: mapReconciliationLine(recon.sales_revenue, "Sales revenue"),
      cogs: mapReconciliationLine(recon.cogs, "COGS"),
      write_offs: mapReconciliationLine(recon.write_offs, "Write-offs"),
    },
  };
}

function mapReportError(error: unknown, fallback: string): string {
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
        normalized.includes("get_profit_and_loss") &&
        (normalized.includes("does not exist") ||
          normalized.includes("schema cache") ||
          normalized.includes("42883"))
      ) {
        return "Profit and loss is not available yet. Apply the profit and loss database script and try again.";
      }

      if (normalized.includes("insufficient permissions")) {
        return "You do not have permission to view profit and loss.";
      }

      if (normalized.includes("period end must be on or after period start")) {
        return "Period end must be on or after period start.";
      }

      if (normalized.includes("missing from chart of accounts")) {
        return "Required P&L accounts are missing from the chart of accounts.";
      }

      return null;
    },
  });
}

export const profitAndLossService = {
  async getProfitAndLoss(
    periodStart: string,
    periodEnd: string,
  ): Promise<ServiceResult<ProfitAndLossReport>> {
    try {
      const start = periodStart.trim();
      const end = periodEnd.trim();
      if (!start || !end) {
        return fail("Period start and period end are required.");
      }

      const { data, error } = await supabase.rpc("get_profit_and_loss", {
        p_period_start: start,
        p_period_end: end,
      });

      if (error || data == null) {
        return fail(mapReportError(error, "Failed to load profit and loss."));
      }

      try {
        return ok(mapReport(data));
      } catch {
        return fail("Profit and loss response was invalid.");
      }
    } catch (error) {
      return fail(mapReportError(error, "Failed to load profit and loss."));
    }
  },
};
