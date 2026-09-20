/**
 * Posting-failures read/resolve service (audit finding #8).
 *
 * Reads unresolved rows from posting_failures (RLS: owner/partner).
 * Resolves through resolve_posting_failure only — never updates the table.
 */

import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import {
  POSTING_FAILURE_SOURCE_FLOWS,
  type PostingFailure,
  type PostingFailureSourceFlow,
} from "../types/posting-failure";

const TABLE = "posting_failures";

const SELECT =
  "id, occurred_at, source_flow, entity_type, entity_id, business_event_id, error_message, resolved_at, resolved_by, resolution_note";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface PostingFailureSqlRow {
  id: string;
  occurred_at: string;
  source_flow: string;
  entity_type: string;
  entity_id: string;
  business_event_id: string | null;
  error_message: string;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_note: string | null;
}

function isSourceFlow(value: string): value is PostingFailureSourceFlow {
  return (POSTING_FAILURE_SOURCE_FLOWS as readonly string[]).includes(value);
}

function mapRow(row: PostingFailureSqlRow): PostingFailure {
  if (!isSourceFlow(row.source_flow)) {
    throw new Error("Posting failure source_flow is invalid.");
  }

  return {
    id: row.id,
    occurredAt: row.occurred_at,
    sourceFlow: row.source_flow,
    entityType: row.entity_type,
    entityId: row.entity_id,
    businessEventId: row.business_event_id,
    errorMessage: row.error_message,
    resolvedAt: row.resolved_at,
    resolvedBy: row.resolved_by,
    resolutionNote: row.resolution_note,
  };
}

function mapError(error: unknown, fallback: string): string {
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
        normalized.includes("posting_failures") &&
        (normalized.includes("does not exist") ||
          normalized.includes("schema cache") ||
          normalized.includes("42p01"))
      ) {
        return "Posting failure log is not available yet. Apply the posting failures database script and try again.";
      }

      if (
        normalized.includes("record_posting_failure") ||
        normalized.includes("resolve_posting_failure")
      ) {
        if (
          normalized.includes("does not exist") ||
          normalized.includes("schema cache") ||
          normalized.includes("42883")
        ) {
          return "Posting failure log is not available yet. Apply the posting failures database script and try again.";
        }
      }

      if (normalized.includes("insufficient permissions")) {
        return "You do not have permission to resolve posting failures.";
      }

      if (normalized.includes("already resolved")) {
        return "This posting failure is already resolved.";
      }

      if (normalized.includes("was not found")) {
        return "Posting failure was not found.";
      }

      return null;
    },
  });
}

export const postingFailuresService = {
  async listUnresolved(): Promise<ServiceResult<PostingFailure[]>> {
    try {
      const { data, error } = await supabase
        .from(TABLE)
        .select(SELECT)
        .is("resolved_at", null)
        .order("occurred_at", { ascending: false });

      if (error) {
        return fail(mapError(error, "Failed to load posting failures"));
      }

      try {
        return ok(
          ((data as PostingFailureSqlRow[] | null) ?? []).map(mapRow),
        );
      } catch {
        return fail("Posting failure response was invalid.");
      }
    } catch (error) {
      return fail(mapError(error, "Failed to load posting failures"));
    }
  },

  async resolve(
    id: string,
    resolutionNote?: string | null,
  ): Promise<ServiceResult<{ id: string }>> {
    try {
      const trimmedId = id?.trim() ?? "";
      if (!trimmedId || !UUID_RE.test(trimmedId)) {
        return fail("Posting failure id is required.");
      }

      const note = resolutionNote?.trim() ?? "";

      const { error } = await supabase.rpc("resolve_posting_failure", {
        p_id: trimmedId,
        p_resolution_note: note.length > 0 ? note : null,
      });

      if (error) {
        return fail(mapError(error, "Failed to resolve posting failure"));
      }

      return ok({ id: trimmedId });
    } catch (error) {
      return fail(mapError(error, "Failed to resolve posting failure"));
    }
  },
};
