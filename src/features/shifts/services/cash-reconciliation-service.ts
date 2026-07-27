/**
 * Cash Reconciliation service (DEV-113).
 *
 * Reconciles counted till cash against expected cash for a closed Shift.
 * One immutable row per shift. Does not touch Sales / Accounting.
 */

import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import type {
  CashReconciliation,
  ReconcileShiftCashInput,
  ReconcileShiftCashResult,
} from "../types/cash-reconciliation";
import { shiftService } from "./shift-service";
import {
  assertCanReconcileShift,
  assertCashReconciliationHistoricallyImmutable,
  assertShiftNotAlreadyReconciled,
  calculateCashDifference,
  calculateExpectedCash,
  getCashReconciliationStatus,
  validateReconcileShiftCashInput,
} from "../utils/cash-reconciliation";

interface CashReconciliationRow {
  id: string;
  shift_id: string;
  expected_cash: number | string;
  counted_cash: number | string;
  difference: number | string;
  notes: string | null;
  reconciled_at: string;
  created_at: string;
}

const RECONCILIATION_SELECT =
  "id, shift_id, expected_cash, counted_cash, difference, notes, reconciled_at, created_at";

function toMoneyNumber(value: number | string): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
}

function mapReconciliation(
  row: CashReconciliationRow,
): CashReconciliation | null {
  const expected = toMoneyNumber(row.expected_cash);
  const counted = toMoneyNumber(row.counted_cash);
  const difference = toMoneyNumber(row.difference);

  if (expected === null || counted === null || difference === null) {
    return null;
  }

  return {
    id: row.id,
    shift_id: row.shift_id,
    expected_cash: expected,
    counted_cash: counted,
    difference,
    notes: row.notes,
    reconciled_at: row.reconciled_at,
    created_at: row.created_at,
  };
}

function optionalNotes(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function mapReconciliationError(error: unknown, fallback: string): string {
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
        normalized.includes("shift_cash_reconciliations_shift_uidx") ||
        (normalized.includes("duplicate") &&
          normalized.includes("shift_cash_reconciliations"))
      ) {
        return "This shift is already reconciled.";
      }

      if (
        normalized.includes("counted_non_negative") ||
        normalized.includes("counted_cash")
      ) {
        return "Counted cash cannot be negative.";
      }

      if (
        normalized.includes("shift_cash_reconciliations") &&
        (normalized.includes("does not exist") ||
          normalized.includes("schema cache") ||
          normalized.includes("42p01"))
      ) {
        return "Cash reconciliation is not available yet. Apply the cash reconciliation database script and try again.";
      }

      return null;
    },
  });
}

export const cashReconciliationService = {
  calculateExpectedCash,
  calculateCashDifference,
  getCashReconciliationStatus,
  assertCanReconcileShift,
  assertShiftNotAlreadyReconciled,
  assertCashReconciliationHistoricallyImmutable,

  /**
   * Calculate expected cash for a closed shift (opening + in − out).
   * Sales cash totals are not wired yet (no Sales changes in DEV-113).
   */
  getExpectedCashForShift(input: {
    opening_cash?: number;
    cash_in?: number;
    cash_out?: number;
  } = {}): number {
    return calculateExpectedCash(input);
  },

  async getReconciliationForShift(
    shiftId: string,
  ): Promise<ServiceResult<CashReconciliation | null>> {
    try {
      const trimmed = shiftId.trim();
      if (!trimmed) {
        return fail("Shift id is required.");
      }

      const { data, error } = await supabase
        .from("shift_cash_reconciliations")
        .select(RECONCILIATION_SELECT)
        .eq("shift_id", trimmed)
        .maybeSingle();

      if (error) {
        return fail(
          mapReconciliationError(error, "Failed to load cash reconciliation"),
        );
      }

      if (!data) {
        return ok(null);
      }

      const mapped = mapReconciliation(data as CashReconciliationRow);
      if (!mapped) {
        return fail("Cash reconciliation data is invalid.");
      }

      return ok(mapped);
    } catch (error) {
      return fail(
        mapReconciliationError(error, "Failed to load cash reconciliation"),
      );
    }
  },

  /**
   * Create the immutable reconciliation for a closed shift.
   */
  async reconcileShiftCash(
    input: ReconcileShiftCashInput,
  ): Promise<ServiceResult<ReconcileShiftCashResult>> {
    try {
      const validationError = validateReconcileShiftCashInput(input);
      if (validationError) {
        return fail(validationError);
      }

      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError || !user) {
        return fail("You must be signed in to reconcile cash.");
      }

      const shiftId = input.shift_id.trim();

      const shiftResult = await shiftService.getShiftById(shiftId);
      if (shiftResult.error) {
        return fail(shiftResult.error);
      }

      const shiftGuard = assertCanReconcileShift(shiftResult.data);
      if (shiftGuard) {
        return fail(shiftGuard);
      }

      const existingResult = await this.getReconciliationForShift(shiftId);
      if (existingResult.error) {
        return fail(existingResult.error);
      }

      const duplicateGuard = assertShiftNotAlreadyReconciled(
        existingResult.data,
      );
      if (duplicateGuard) {
        return fail(duplicateGuard);
      }

      const expectedCash = calculateExpectedCash({
        opening_cash: input.opening_cash,
        cash_in: input.cash_in,
        cash_out: input.cash_out,
      });
      const countedCash = input.counted_cash;
      const difference = calculateCashDifference(countedCash, expectedCash);

      const { data, error } = await supabase
        .from("shift_cash_reconciliations")
        .insert({
          shift_id: shiftId,
          expected_cash: expectedCash,
          counted_cash: countedCash,
          difference,
          notes: optionalNotes(input.notes),
          reconciled_by: user.id,
        })
        .select(RECONCILIATION_SELECT)
        .single();

      if (error) {
        return fail(
          mapReconciliationError(error, "Failed to save cash reconciliation"),
        );
      }

      const mapped = mapReconciliation(data as CashReconciliationRow);
      if (!mapped) {
        return fail("Cash reconciliation saved but the response was invalid.");
      }

      if (
        mapped.shift_id !== shiftId ||
        mapped.expected_cash !== expectedCash ||
        mapped.counted_cash !== countedCash ||
        mapped.difference !== difference
      ) {
        return fail("Cash reconciliations are immutable historical records.");
      }

      return ok({ reconciliation: mapped });
    } catch (error) {
      return fail(
        mapReconciliationError(error, "Failed to save cash reconciliation"),
      );
    }
  },
};
