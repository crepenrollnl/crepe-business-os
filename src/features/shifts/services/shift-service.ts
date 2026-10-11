/**
 * Shift Management service (DEV-112).
 *
 * Open / close / active lookup for the business-day shift container.
 * Writes go through open_shift / close_shift (sql/142), which enforce a
 * single open shift; closed shifts are never mutated again.
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
import {
  mapDailyProfitSummary,
  type DailyProfitSummaryRow,
} from "./daily-profit-summary-service";
import {
  mapDailySalesSummary,
  type DailySalesSummaryRow,
} from "./daily-sales-summary-service";

interface ShiftRow {
  id: string;
  opened_at: string;
  closed_at: string | null;
  status: string;
  notes: string | null;
  created_at: string;
}

/** close_shift (sql/142) jsonb result. */
interface CloseShiftRpcResult {
  shift: ShiftRow;
  sales_summary: DailySalesSummaryRow;
  profit_summary: DailyProfitSummaryRow;
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
   * Open a new shift via open_shift (sql/142). The server enforces the
   * single open shift, stamps opened_at and takes the user from the login.
   */
  async openShift(
    input: OpenShiftInput = {},
  ): Promise<ServiceResult<OpenShiftResult>> {
    try {
      const validationError = validateOpenShiftInput(input);
      if (validationError) {
        return fail(validationError);
      }

      const { data, error } = await supabase.rpc("open_shift", {
        p_notes: optionalNotes(input.notes),
      });

      if (error) {
        return fail(mapShiftError(error, "Failed to open shift"));
      }

      const mapped = data ? mapShift(data as ShiftRow) : null;
      if (!mapped) {
        return fail("Shift opened but the response was invalid.");
      }

      return ok({ shift: mapped });
    } catch (error) {
      return fail(mapShiftError(error, "Failed to open shift"));
    }
  },

  /**
   * Close an open shift via close_shift (sql/142). The shift and both
   * daily summaries are written in one transaction on the server, so the
   * summaries come back with the closed shift. notes undefined keeps the
   * shift's current notes.
   */
  async closeShift(
    input: CloseShiftInput,
  ): Promise<ServiceResult<CloseShiftResult>> {
    try {
      const validationError = validateCloseShiftInput(input);
      if (validationError) {
        return fail(validationError);
      }

      const { data, error } = await supabase.rpc("close_shift", {
        p_shift_id: input.shift_id.trim(),
        p_notes: input.notes === undefined ? null : optionalNotes(input.notes),
      });

      if (error) {
        return fail(mapShiftError(error, "Failed to close shift"));
      }

      const result = data as CloseShiftRpcResult | null;
      const shift = result?.shift ? mapShift(result.shift) : null;
      const salesSummary = result?.sales_summary
        ? mapDailySalesSummary(result.sales_summary)
        : null;
      const profitSummary = result?.profit_summary
        ? mapDailyProfitSummary(result.profit_summary)
        : null;

      if (!shift || !salesSummary || !profitSummary) {
        return fail("Shift closed but the response was invalid.");
      }

      return ok({ shift, salesSummary, profitSummary });
    } catch (error) {
      return fail(mapShiftError(error, "Failed to close shift"));
    }
  },
};
