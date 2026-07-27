/**
 * Shift validation helpers (DEV-112).
 *
 * Pure rules for open / close / immutability. No database access.
 */

import { MAX_NOTES_LENGTH } from "@/constants/limits";
import type { CloseShiftInput, OpenShiftInput, Shift } from "../types/shift";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateOpenShiftInput(input: OpenShiftInput): string | null {
  if (input.notes !== undefined && input.notes !== null) {
    if (input.notes.trim().length > MAX_NOTES_LENGTH) {
      return `Notes must be ${MAX_NOTES_LENGTH} characters or fewer.`;
    }
  }

  return null;
}

export function validateCloseShiftInput(input: CloseShiftInput): string | null {
  if (!input.shift_id || !UUID_RE.test(input.shift_id.trim())) {
    return "Shift id is required.";
  }

  if (input.notes !== undefined && input.notes !== null) {
    if (input.notes.trim().length > MAX_NOTES_LENGTH) {
      return `Notes must be ${MAX_NOTES_LENGTH} characters or fewer.`;
    }
  }

  return null;
}

/**
 * Reject opening when another shift is already active.
 */
export function assertCanOpenShift(
  activeShift: Shift | null,
): string | null {
  if (activeShift && activeShift.status === "open") {
    return "A shift is already open. Close it before opening another.";
  }

  return null;
}

/**
 * Reject closing a missing or already-closed shift.
 */
export function assertCanCloseShift(shift: Shift | null): string | null {
  if (!shift) {
    return "Shift was not found.";
  }

  if (shift.status === "closed") {
    return "This shift is already closed.";
  }

  if (shift.status !== "open") {
    return "Only an open shift can be closed.";
  }

  return null;
}

/**
 * Historical closed shifts are immutable after close.
 */
export function assertShiftHistoricallyImmutable(input: {
  previous: Shift;
  next: Shift;
}): string | null {
  if (input.previous.status !== "closed") {
    return null;
  }

  if (
    input.previous.id !== input.next.id ||
    input.previous.opened_at !== input.next.opened_at ||
    input.previous.closed_at !== input.next.closed_at ||
    input.previous.status !== input.next.status ||
    input.previous.notes !== input.next.notes ||
    input.previous.created_at !== input.next.created_at
  ) {
    return "Closed shifts are immutable historical records.";
  }

  return null;
}
