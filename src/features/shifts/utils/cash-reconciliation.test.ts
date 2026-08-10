/**
 * Pure cash reconciliation coverage (DEV-113).
 */

import { describe, expect, it } from "vitest";
import type { CashReconciliation } from "../types/cash-reconciliation";
import type { Shift } from "../types/shift";
import {
  assertCanReconcileShift,
  assertCashReconciliationHistoricallyImmutable,
  assertShiftNotAlreadyReconciled,
  calculateCashDifference,
  calculateExpectedCash,
  getCashReconciliationStatus,
  validateReconcileShiftCashInput,
} from "./cash-reconciliation";

const SHIFT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RECON_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function closedShift(overrides?: Partial<Shift>): Shift {
  return {
    id: SHIFT_ID,
    opened_at: "2026-07-26T08:00:00.000Z",
    closed_at: "2026-07-26T18:00:00.000Z",
    status: "closed",
    notes: null,
    created_at: "2026-07-26T08:00:00.000Z",
    ...overrides,
  };
}

function reconciliation(
  overrides?: Partial<CashReconciliation>,
): CashReconciliation {
  return {
    id: RECON_ID,
    shift_id: SHIFT_ID,
    expected_cash: 100,
    counted_cash: 100,
    difference: 0,
    notes: null,
    reconciled_at: "2026-07-26T18:05:00.000Z",
    created_at: "2026-07-26T18:05:00.000Z",
    ...overrides,
  };
}

describe("cash-reconciliation utils (DEV-113)", () => {
  describe("calculateExpectedCash", () => {
    it("defaults to zero when no cash movements exist", () => {
      expect(calculateExpectedCash()).toBe(0);
    });

    it("calculates opening + in − out", () => {
      expect(
        calculateExpectedCash({
          opening_cash: 50,
          cash_in: 120.55,
          cash_out: 10.1,
        }),
      ).toBe(160.45);
    });
  });

  describe("calculateCashDifference / status", () => {
    it("reports balanced when counted equals expected", () => {
      expect(calculateCashDifference(100, 100)).toBe(0);
      expect(getCashReconciliationStatus(0)).toBe("balanced");
    });

    it("reports a positive difference (over)", () => {
      expect(calculateCashDifference(105.5, 100)).toBe(5.5);
      expect(getCashReconciliationStatus(5.5)).toBe("difference");
    });

    it("reports a negative difference (short)", () => {
      expect(calculateCashDifference(90, 100)).toBe(-10);
      expect(getCashReconciliationStatus(-10)).toBe("difference");
    });
  });

  describe("validateReconcileShiftCashInput", () => {
    it("rejects negative counted cash", () => {
      expect(
        validateReconcileShiftCashInput({
          shift_id: SHIFT_ID,
          counted_cash: -1,
        }),
      ).toBe("Counted cash cannot be negative.");
    });

    it("accepts zero counted cash", () => {
      expect(
        validateReconcileShiftCashInput({
          shift_id: SHIFT_ID,
          counted_cash: 0,
        }),
      ).toBeNull();
    });
  });

  describe("guards", () => {
    it("rejects reconciling an active shift", () => {
      expect(
        assertCanReconcileShift(
          closedShift({ status: "open", closed_at: null }),
        ),
      ).toBe("Close the shift before reconciling cash.");
    });

    it("allows reconciling a closed shift", () => {
      expect(assertCanReconcileShift(closedShift())).toBeNull();
    });

    it("rejects duplicate reconciliation", () => {
      expect(assertShiftNotAlreadyReconciled(reconciliation())).toBe(
        "This shift is already reconciled.",
      );
      expect(assertShiftNotAlreadyReconciled(null)).toBeNull();
    });

    it("preserves historical reconciliation immutability", () => {
      const previous = reconciliation();
      expect(
        assertCashReconciliationHistoricallyImmutable({
          previous,
          next: { ...previous },
        }),
      ).toBeNull();

      expect(
        assertCashReconciliationHistoricallyImmutable({
          previous,
          next: reconciliation({ counted_cash: 99, difference: -1 }),
        }),
      ).toBe("Cash reconciliations are immutable historical records.");
    });
  });
});
