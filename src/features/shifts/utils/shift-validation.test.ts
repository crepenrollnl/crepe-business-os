/**
 * Pure validation coverage for Shift Management (DEV-112).
 */

import { describe, expect, it } from "vitest";
import { MAX_NOTES_LENGTH } from "@/constants/limits";
import type { Shift } from "../types/shift";
import {
  assertCanCloseShift,
  assertCanOpenShift,
  assertShiftHistoricallyImmutable,
  validateCloseShiftInput,
  validateOpenShiftInput,
} from "./shift-validation";

const SHIFT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function openShift(overrides?: Partial<Shift>): Shift {
  return {
    id: SHIFT_ID,
    opened_at: "2026-07-26T08:00:00.000Z",
    closed_at: null,
    status: "open",
    notes: null,
    created_at: "2026-07-26T08:00:00.000Z",
    ...overrides,
  };
}

function closedShift(overrides?: Partial<Shift>): Shift {
  return {
    id: SHIFT_ID,
    opened_at: "2026-07-26T08:00:00.000Z",
    closed_at: "2026-07-26T18:00:00.000Z",
    status: "closed",
    notes: "End of day",
    created_at: "2026-07-26T08:00:00.000Z",
    ...overrides,
  };
}

describe("shift-validation (DEV-112)", () => {
  describe("validateOpenShiftInput", () => {
    it("accepts empty input", () => {
      expect(validateOpenShiftInput({})).toBeNull();
    });

    it("rejects oversized notes", () => {
      expect(
        validateOpenShiftInput({
          notes: "A".repeat(MAX_NOTES_LENGTH + 1),
        }),
      ).toBe(`Notes must be ${MAX_NOTES_LENGTH} characters or fewer.`);
    });
  });

  describe("validateCloseShiftInput", () => {
    it("requires a valid shift id", () => {
      expect(validateCloseShiftInput({ shift_id: "" })).toBe(
        "Shift id is required.",
      );
      expect(validateCloseShiftInput({ shift_id: "not-a-uuid" })).toBe(
        "Shift id is required.",
      );
    });

    it("accepts a valid shift id", () => {
      expect(validateCloseShiftInput({ shift_id: SHIFT_ID })).toBeNull();
    });
  });

  describe("assertCanOpenShift", () => {
    it("allows open when no active shift exists", () => {
      expect(assertCanOpenShift(null)).toBeNull();
    });

    it("rejects duplicate open when a shift is already active", () => {
      expect(assertCanOpenShift(openShift())).toBe(
        "A shift is already open. Close it before opening another.",
      );
    });
  });

  describe("assertCanCloseShift", () => {
    it("rejects closing a non-existent shift", () => {
      expect(assertCanCloseShift(null)).toBe("Shift was not found.");
    });

    it("rejects closing an already closed shift", () => {
      expect(assertCanCloseShift(closedShift())).toBe(
        "This shift is already closed.",
      );
    });

    it("allows closing an open shift", () => {
      expect(assertCanCloseShift(openShift())).toBeNull();
    });
  });

  describe("assertShiftHistoricallyImmutable", () => {
    it("ignores open shifts", () => {
      expect(
        assertShiftHistoricallyImmutable({
          previous: openShift(),
          next: openShift({ notes: "changed" }),
        }),
      ).toBeNull();
    });

    it("preserves historical closed shift fields", () => {
      const previous = closedShift();
      expect(
        assertShiftHistoricallyImmutable({
          previous,
          next: { ...previous },
        }),
      ).toBeNull();
    });

    it("rejects mutation of a closed historical shift", () => {
      const previous = closedShift();
      expect(
        assertShiftHistoricallyImmutable({
          previous,
          next: closedShift({ notes: "tampered" }),
        }),
      ).toBe("Closed shifts are immutable historical records.");

      expect(
        assertShiftHistoricallyImmutable({
          previous,
          next: closedShift({ closed_at: "2026-07-26T20:00:00.000Z" }),
        }),
      ).toBe("Closed shifts are immutable historical records.");
    });
  });
});
