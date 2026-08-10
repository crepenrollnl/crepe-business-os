/**
 * Cash Reconciliation contracts (DEV-113).
 *
 * One immutable reconciliation per closed Shift.
 * Difference = Counted Cash − Expected Cash.
 */

export interface CashReconciliation {
  id: string;
  shift_id: string;
  expected_cash: number;
  counted_cash: number;
  difference: number;
  notes: string | null;
  reconciled_at: string;
  created_at: string;
}

export interface ExpectedCashInput {
  /** Opening float / till start. */
  opening_cash?: number;
  /** Cash received during the shift (e.g. cash sales). */
  cash_in?: number;
  /** Cash paid out during the shift. */
  cash_out?: number;
}

export interface ReconcileShiftCashInput {
  shift_id: string;
  counted_cash: number;
  /** Optional inputs used to calculate expected cash before freeze. */
  opening_cash?: number;
  cash_in?: number;
  cash_out?: number;
  notes?: string | null;
}

export interface ReconcileShiftCashResult {
  reconciliation: CashReconciliation;
}

export type CashReconciliationStatus = "balanced" | "difference";
