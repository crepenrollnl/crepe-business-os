/**
 * Purchase → Accounting read model.
 *
 * Since sql/150 (audit D2) the app no longer posts purchase journals: the
 * database posts purchase_received at COMMIT of receive_purchase, with the
 * same stable business_event_id as
 * stableBusinessEventId("purchase_received:<purchase id>") from
 * ../utils/stable-business-event-id, and records any failure in
 * posting_failures. This service only reads whether that journal exists.
 */

import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import type { PurchasePostingStatus } from "../types/purchase-accounting-preview";
import { stableBusinessEventId } from "../utils/stable-business-event-id";

function purchaseReceivedIdempotencyKey(purchaseId: string): string {
  return `purchase_received:${purchaseId}`;
}

export const purchasePostingStatusService = {
  /**
   * Read-only posting status for a received purchase.
   * Looks up a posted journal_entries row by stable business_event_id.
   */
  async getPurchaseReceivedPostingStatus(
    purchaseId: string,
  ): Promise<ServiceResult<PurchasePostingStatus>> {
    try {
      const trimmed = purchaseId?.trim() ?? "";
      if (!trimmed) {
        return fail("Purchase id is required.");
      }

      const businessEventId = stableBusinessEventId(
        purchaseReceivedIdempotencyKey(trimmed),
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
          toUserError(error, "Failed to load purchase accounting status"),
        );
      }

      return ok(data ? "posted" : "pending");
    } catch (error) {
      return fail(
        toUserError(error, "Failed to load purchase accounting status"),
      );
    }
  },
};
