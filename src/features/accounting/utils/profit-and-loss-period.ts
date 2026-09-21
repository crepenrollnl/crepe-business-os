/**
 * Local calendar date bounds for get_profit_and_loss (date, not timestamptz).
 */

import type { ProfitAndLossReport } from "../types/profit-and-loss";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function formatDateOnly(date: Date): string {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function monthBounds(
  year: number,
  monthIndex: number,
): { start: string; end: string } {
  const start = new Date(year, monthIndex, 1);
  const end = new Date(year, monthIndex + 1, 0);
  return {
    start: formatDateOnly(start),
    end: formatDateOnly(end),
  };
}

export function parseDateOnly(value: string): Date | null {
  const trimmed = value.trim();
  if (!DATE_ONLY.test(trimmed)) {
    return null;
  }
  const parsed = new Date(`${trimmed}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

export function resolveCustomPeriod(
  from: string,
  to: string,
): { start: string; end: string } | { error: string } {
  const fromDate = parseDateOnly(from);
  const toDate = parseDateOnly(to);
  if (!fromDate || !toDate) {
    return { error: "Enter a valid start and end date." };
  }
  if (fromDate.getTime() > toDate.getTime()) {
    return { error: "Start date must be on or before end date." };
  }
  return {
    start: formatDateOnly(fromDate),
    end: formatDateOnly(toDate),
  };
}

export function hasReconciliationMismatch(report: ProfitAndLossReport): boolean {
  const reconciliation = report.reconciliation;
  return (
    reconciliation.sales_revenue.mismatch ||
    reconciliation.cogs.mismatch ||
    reconciliation.write_offs.mismatch
  );
}
