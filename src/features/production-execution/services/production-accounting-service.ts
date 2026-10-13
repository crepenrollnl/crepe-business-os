/**
 * Production → Accounting read model (DEV-106).
 *
 * Since sql/149 (audit D2) the app no longer posts production journals: a
 * deferred trigger on production_sessions posts production_completed at
 * COMMIT of the completion, with the same stable business_event_id as
 * stableBusinessEventId("production_completed:<session id>") from
 * ../utils/stable-business-event-id, and records any failure in
 * posting_failures. This service only reads whether that journal exists.
 */

import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import type { ProductionAccountingPostingStatus } from "../types/production-session";
import { stableBusinessEventId } from "../utils/stable-business-event-id";

function productionCompletedIdempotencyKey(sessionId: string): string {
  return `production_completed:${sessionId}`;
}

export const productionAccountingService = {
  /**
   * Read-only posting status for a completed production session (DEV-106).
   * Looks up existing journal_entries by stable business_event_id.
   * Does not propose, post, or change Accounting logic.
   */
  async getProductionCompletedPostingStatus(
    sessionId: string,
  ): Promise<ServiceResult<ProductionAccountingPostingStatus>> {
    try {
      const trimmed = sessionId?.trim() ?? "";
      if (!trimmed) {
        return fail("Production session id is required.");
      }

      const businessEventId = stableBusinessEventId(
        productionCompletedIdempotencyKey(trimmed),
      );

      const { data, error } = await supabase
        .from("journal_entries")
        .select("id, status")
        .eq("business_event_id", businessEventId)
        .eq("status", "posted")
        .maybeSingle();

      if (error) {
        const message = error.message?.toLowerCase() ?? "";
        if (
          message.includes("journal_entries") &&
          (message.includes("does not exist") ||
            message.includes("schema cache") ||
            message.includes("42p01"))
        ) {
          return ok("pending");
        }

        return fail(
          toUserError(error, "Failed to load production accounting status"),
        );
      }

      return ok(data ? "posted" : "pending");
    } catch (error) {
      return fail(
        toUserError(error, "Failed to load production accounting status"),
      );
    }
  },
};
