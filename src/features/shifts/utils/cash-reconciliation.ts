/**
 * Cash reconciliation pure helpers (DEV-113).
 *
 * Expected / difference / status — no database access.
 */

import { MAX_NOTES_LENGTH } from "@/constants/limits";
import { roundMoney } from "@/lib/money";
import type { Shift } from "../types/shift";
import type {
  CashReconciliation,
  CashReconciliationStatus,
  ExpectedCashInput,
  ReconcileShiftCashInput,
} from "../types/cash-reconciliation";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validateNonNegativeMoney(
  value: number,
  label: string,
): string | null {
  if (!isFiniteNumber(value)) {
    return `${label} must be a valid amount.`;
  }
  if (value < 0) {
    return `${label} cannot be negative.`;
  }
  return null;
}

/**
 * Expected cash for a shift window.
 * opening + cash in − cash out (rounded).
 */
export function calculateExpectedCash(input: ExpectedCashInput = {}): number {
  const opening = input.opening_cash ?? 0;
  const cashIn = input.cash_in ?? 0;
  const cashOut = input.cash_out ?? 0;
  return roundMoney(opening + cashIn - cashOut);
}

/**
 * Difference = Counted − Expected.
 */
export function calculateCashDifference(
  countedCash: number,
  expectedCash: number,
): number {
  return roundMoney(countedCash - expectedCash);
}

export function getCashReconciliationStatus(
  difference: number,
): CashReconciliationStatus {
  return roundMoney(difference) === 0 ? "balanced" : "difference";
}

export function validateReconcileShiftCashInput(
  input: ReconcileShiftCashInput,
): string | null {
  if (!input.shift_id || !UUID_RE.test(input.shift_id.trim())) {
    return "Shift id is required.";
  }

  const countedError = validateNonNegativeMoney(
    input.counted_cash,
    "Counted cash",
  );
  if (countedError) {
    return countedError;
  }

  if (input.opening_cash !== undefined) {
    const openingError = validateNonNegativeMoney(
      input.opening_cash,
      "Opening cash",
    );
    if (openingError) {
      return openingError;
    }
  }

  if (input.cash_in !== undefined) {
    const cashInError = validateNonNegativeMoney(input.cash_in, "Cash in");
    if (cashInError) {
      return cashInError;
    }
  }

  if (input.cash_out !== undefined) {
    const cashOutError = validateNonNegativeMoney(input.cash_out, "Cash out");
    if (cashOutError) {
      return cashOutError;
    }
  }

  if (input.notes !== undefined && input.notes !== null) {
    if (input.notes.trim().length > MAX_NOTES_LENGTH) {
      return `Notes must be ${MAX_NOTES_LENGTH} characters or fewer.`;
    }
  }

  return null;
}

/**
 * Reject reconciling an active (open) shift.
 */
export function assertCanReconcileShift(shift: Shift | null): string | null {
  if (!shift) {
    return "Shift was not found.";
  }

  if (shift.status === "open") {
    return "Close the shift before reconciling cash.";
  }

  if (shift.status !== "closed") {
    return "Only a closed shift can be reconciled.";
  }

  return null;
}

/**
 * Reject duplicate / already-reconciled shift.
 */
export function assertShiftNotAlreadyReconciled(
  existing: CashReconciliation | null,
): string | null {
  if (existing) {
    return "This shift is already reconciled.";
  }
  return null;
}

/**
 * Historical reconciliations are immutable after create.
 */
export function assertCashReconciliationHistoricallyImmutable(input: {
  previous: CashReconciliation;
  next: CashReconciliation;
}): string | null {
  const { previous, next } = input;

  if (
    previous.id !== next.id ||
    previous.shift_id !== next.shift_id ||
    previous.expected_cash !== next.expected_cash ||
    previous.counted_cash !== next.counted_cash ||
    previous.difference !== next.difference ||
    previous.notes !== next.notes ||
    previous.reconciled_at !== next.reconciled_at ||
    previous.created_at !== next.created_at
  ) {
    return "Cash reconciliations are immutable historical records.";
  }

  return null;
}
