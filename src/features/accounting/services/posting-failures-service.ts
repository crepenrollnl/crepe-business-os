/**
 * Posting-failures read/resolve service (audit finding #8).
 *
 * Reads unresolved rows from posting_failures (RLS: owner/partner).
 * Resolves through resolve_posting_failure only — never updates the table.
 * "Post again" goes through repost_posting_failure (sql/154): the database
 * re-runs its own poster and closes every open row of that operation.
 */

import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import {
  POSTING_FAILURE_SOURCE_FLOWS,
  type PostingFailure,
  type PostingFailureSourceFlow,
  type RepostPostingFailureResult,
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

/**
 * repost_posting_failure (sql/154) raises readable P0001 messages that must
 * reach the user verbatim — including the poster's own reason after
 * "Posting again failed: ", which may contain words the generic mapping
 * below would otherwise rewrite ("was not found", raw constraint text …).
 */
const REPOST_MESSAGE_PREFIXES = [
  "posting again failed:",
  "this write-off failure was recorded before automatic posting.",
  "posting failures of type ",
] as const;

function readMessage(err: unknown): string | null {
  if (typeof err === "string") {
    return err;
  }
  if (
    typeof err === "object" &&
    err !== null &&
    "message" in err &&
    typeof (err as { message: unknown }).message === "string"
  ) {
    return (err as { message: string }).message;
  }
  return null;
}

function mapError(
  error: unknown,
  fallback: string,
  permissionMessage = "You do not have permission to resolve posting failures.",
): string {
  return toUserError(error, fallback, {
    map: (err) => {
      const message = readMessage(err);

      if (!message) {
        return null;
      }

      const normalized = message.toLowerCase();

      if (
        REPOST_MESSAGE_PREFIXES.some((prefix) =>
          normalized.startsWith(prefix),
        )
      ) {
        return message.trim();
      }

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
        normalized.includes("resolve_posting_failure") ||
        normalized.includes("repost_posting_failure")
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
        return permissionMessage;
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

  /**
   * "Post again": repost_posting_failure (sql/154) re-runs the database
   * poster for this row's operation. On success the database has closed the
   * row and every other open row of the same operation (`resolved` = how
   * many). On failure it raises a readable message and the row stays open.
   */
  async repost(id: string): Promise<ServiceResult<RepostPostingFailureResult>> {
    const permissionMessage =
      "Only the owner or a partner can post again.";
    try {
      const trimmedId = id?.trim() ?? "";
      if (!trimmedId || !UUID_RE.test(trimmedId)) {
        return fail("Posting failure id is required.");
      }

      const { data, error } = await supabase.rpc("repost_posting_failure", {
        p_id: trimmedId,
      });

      if (error) {
        return fail(
          mapError(error, "Failed to post again", permissionMessage),
        );
      }

      const result = toRepostResult(data);
      if (!result) {
        return fail("Post again response was invalid.");
      }

      return ok(result);
    } catch (error) {
      return fail(mapError(error, "Failed to post again", permissionMessage));
    }
  },
};

function toRepostResult(data: unknown): RepostPostingFailureResult | null {
  if (typeof data !== "object" || data === null) {
    return null;
  }

  const row = data as Record<string, unknown>;
  const status = row.status;
  const resolved =
    typeof row.resolved === "number" ? row.resolved : Number(row.resolved);

  if (status !== "posted" && status !== "nothing_to_post") {
    return null;
  }

  if (!Number.isInteger(resolved) || resolved < 0) {
    return null;
  }

  return { status, resolved };
}
