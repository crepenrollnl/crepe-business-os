/**
 * Shift Management service (DEV-112).
 *
 * Open / close / active lookup for the business-day shift container.
 * Enforces a single open shift. Closed shifts are never mutated again.
 */

import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import type {
  CloseShiftInput,
  CloseShiftResult,
  OpenShiftInput,
  OpenShiftResult,
  Shift,
  ShiftStatus,
} from "../types/shift";
import { SHIFT_STATUSES } from "../types/shift";
import {
  assertCanCloseShift,
  assertCanOpenShift,
  assertShiftHistoricallyImmutable,
  validateCloseShiftInput,
  validateOpenShiftInput,
} from "../utils/shift-validation";

interface ShiftRow {
  id: string;
  opened_at: string;
  closed_at: string | null;
  status: string;
  notes: string | null;
  created_at: string;
}

const SHIFT_SELECT =
  "id, opened_at, closed_at, status, notes, created_at";

function isShiftStatus(value: string): value is ShiftStatus {
  return (SHIFT_STATUSES as readonly string[]).includes(value);
}

function mapShift(row: ShiftRow): Shift | null {
  if (!isShiftStatus(row.status)) {
    return null;
  }

  return {
    id: row.id,
    opened_at: row.opened_at,
    closed_at: row.closed_at,
    status: row.status,
    notes: row.notes,
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

function mapShiftError(error: unknown, fallback: string): string {
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
        normalized.includes("shifts_one_open_uidx") ||
        (normalized.includes("duplicate") && normalized.includes("shifts"))
      ) {
        return "A shift is already open. Close it before opening another.";
      }

      if (
        normalized.includes("shifts") &&
        (normalized.includes("does not exist") ||
          normalized.includes("schema cache") ||
          normalized.includes("42p01"))
      ) {
        return "Shift management is not available yet. Apply the shifts database script and try again.";
      }

      return null;
    },
  });
}

export const shiftService = {
  assertCanOpenShift,
  assertCanCloseShift,
  assertShiftHistoricallyImmutable,

  /**
   * Lookup the single active (open) shift, if any.
   */
  async getActiveShift(): Promise<ServiceResult<Shift | null>> {
    try {
      const { data, error } = await supabase
        .from("shifts")
        .select(SHIFT_SELECT)
        .eq("status", "open")
        .maybeSingle();

      if (error) {
        return fail(mapShiftError(error, "Failed to load active shift"));
      }

      if (!data) {
        return ok(null);
      }

      const mapped = mapShift(data as ShiftRow);
      if (!mapped) {
        return fail("Active shift data is invalid.");
      }

      return ok(mapped);
    } catch (error) {
      return fail(mapShiftError(error, "Failed to load active shift"));
    }
  },

  /**
   * Lookup a shift by id (open or closed).
   */
  async getShiftById(shiftId: string): Promise<ServiceResult<Shift | null>> {
    try {
      const trimmed = shiftId.trim();
      if (!trimmed) {
        return fail("Shift id is required.");
      }

      const { data, error } = await supabase
        .from("shifts")
        .select(SHIFT_SELECT)
        .eq("id", trimmed)
        .maybeSingle();

      if (error) {
        return fail(mapShiftError(error, "Failed to load shift"));
      }

      if (!data) {
        return ok(null);
      }

      const mapped = mapShift(data as ShiftRow);
      if (!mapped) {
        return fail("Shift data is invalid.");
      }

      return ok(mapped);
    } catch (error) {
      return fail(mapShiftError(error, "Failed to load shift"));
    }
  },

  /**
   * Most recently closed shift (for cash reconciliation after close).
   */
  async getLatestClosedShift(): Promise<ServiceResult<Shift | null>> {
    try {
      const { data, error } = await supabase
        .from("shifts")
        .select(SHIFT_SELECT)
        .eq("status", "closed")
        .order("closed_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        return fail(mapShiftError(error, "Failed to load closed shift"));
      }

      if (!data) {
        return ok(null);
      }

      const mapped = mapShift(data as ShiftRow);
      if (!mapped) {
        return fail("Closed shift data is invalid.");
      }

      return ok(mapped);
    } catch (error) {
      return fail(mapShiftError(error, "Failed to load closed shift"));
    }
  },

  /**
   * Open a new shift. Fails when another shift is already open.
   */
  async openShift(
    input: OpenShiftInput = {},
  ): Promise<ServiceResult<OpenShiftResult>> {
    try {
      const validationError = validateOpenShiftInput(input);
      if (validationError) {
        return fail(validationError);
      }

      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError || !user) {
        return fail("You must be signed in to open a shift.");
      }

      const activeResult = await this.getActiveShift();
      if (activeResult.error) {
        return fail(activeResult.error);
      }

      const openGuard = assertCanOpenShift(activeResult.data);
      if (openGuard) {
        return fail(openGuard);
      }

      const nowIso = new Date().toISOString();
      const { data, error } = await supabase
        .from("shifts")
        .insert({
          status: "open",
          opened_at: nowIso,
          closed_at: null,
          notes: optionalNotes(input.notes),
          opened_by: user.id,
        })
        .select(SHIFT_SELECT)
        .single();

      if (error) {
        return fail(mapShiftError(error, "Failed to open shift"));
      }

      const mapped = mapShift(data as ShiftRow);
      if (!mapped) {
        return fail("Shift opened but the response was invalid.");
      }

      return ok({ shift: mapped });
    } catch (error) {
      return fail(mapShiftError(error, "Failed to open shift"));
    }
  },

  /**
   * Close an open shift. Preserves historical opened_at / created_at.
   */
  async closeShift(
    input: CloseShiftInput,
  ): Promise<ServiceResult<CloseShiftResult>> {
    try {
      const validationError = validateCloseShiftInput(input);
      if (validationError) {
        return fail(validationError);
      }

      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError || !user) {
        return fail("You must be signed in to close a shift.");
      }

      const shiftId = input.shift_id.trim();

      const { data: existing, error: loadError } = await supabase
        .from("shifts")
        .select(SHIFT_SELECT)
        .eq("id", shiftId)
        .maybeSingle();

      if (loadError) {
        return fail(mapShiftError(loadError, "Failed to load shift"));
      }

      const current = existing ? mapShift(existing as ShiftRow) : null;
      const closeGuard = assertCanCloseShift(current);
      if (closeGuard) {
        return fail(closeGuard);
      }

      if (!current) {
        return fail("Shift was not found.");
      }

      const nowIso = new Date().toISOString();
      const nextNotes =
        input.notes !== undefined
          ? optionalNotes(input.notes)
          : current.notes;

      const { data, error } = await supabase
        .from("shifts")
        .update({
          status: "closed",
          closed_at: nowIso,
          notes: nextNotes,
          closed_by: user.id,
        })
        .eq("id", shiftId)
        .eq("status", "open")
        .select(SHIFT_SELECT)
        .maybeSingle();

      if (error) {
        return fail(mapShiftError(error, "Failed to close shift"));
      }

      if (!data) {
        return fail("This shift is already closed.");
      }

      const mapped = mapShift(data as ShiftRow);
      if (!mapped) {
        return fail("Shift closed but the response was invalid.");
      }

      // Closed record must preserve identity + opened_at.
      if (mapped.opened_at !== current.opened_at || mapped.id !== current.id) {
        return fail("Closed shifts are immutable historical records.");
      }

      return ok({ shift: mapped });
    } catch (error) {
      return fail(mapShiftError(error, "Failed to close shift"));
    }
  },
};
