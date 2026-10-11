/**
 * Shift Management contracts (DEV-112).
 *
 * A Shift is the operational container for the business day.
 * Only one open shift may exist at a time. Closed shifts are historical.
 */

import type { DailyProfitSummary } from "./daily-profit-summary";
import type { DailySalesSummary } from "./daily-sales-summary";

export const SHIFT_STATUSES = ["open", "closed"] as const;

export type ShiftStatus = (typeof SHIFT_STATUSES)[number];

export interface Shift {
  id: string;
  opened_at: string;
  closed_at: string | null;
  status: ShiftStatus;
  notes: string | null;
  created_at: string;
}

export interface OpenShiftInput {
  notes?: string | null;
}

export interface CloseShiftInput {
  shift_id: string;
  notes?: string | null;
}

export interface OpenShiftResult {
  shift: Shift;
}

export interface CloseShiftResult {
  shift: Shift;
  /** Written by close_shift in the same transaction as the close. */
  salesSummary: DailySalesSummary;
  /** Written by close_shift in the same transaction as the close. */
  profitSummary: DailyProfitSummary;
}
