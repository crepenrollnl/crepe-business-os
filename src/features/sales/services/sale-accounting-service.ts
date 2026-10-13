/**
 * Sales → Accounting read model (DEV-111).
 *
 * Since sql/147 (audit D2/K3) the app no longer posts sale journals: a
 * deferred trigger on sales posts sale_completed + cogs_recognized at
 * COMMIT of the confirmation, with the same stable business_event_id as
 * stableBusinessEventId("sale_completed:<id>") /
 * stableBusinessEventId("cogs_recognized:<id>"), and records any failure in
 * posting_failures. This service only reads whether those journals exist.
 */

import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import type { SaleAccountingPostingStatus } from "../types/sale-accounting";
import { stableBusinessEventId } from "../utils/stable-business-event-id";

function saleRevenueIdempotencyKey(saleId: string): string {
  return `sale_completed:${saleId}`;
}

function saleCogsIdempotencyKey(saleId: string): string {
  return `cogs_recognized:${saleId}`;
}

export const saleAccountingService = {
  /**
   * Read-only posting status for a completed sale (DEV-111).
   * Looks up existing journal_entries by stable business_event_id
   * for sale_completed and/or cogs_recognized.
   * Does not propose, post, or change Accounting logic.
   */
  async getSaleCompletedPostingStatus(
    saleId: string,
  ): Promise<ServiceResult<SaleAccountingPostingStatus>> {
    try {
      const trimmed = saleId?.trim() ?? "";
      if (!trimmed) {
        return fail("Sale id is required.");
      }

      const eventIds = [
        stableBusinessEventId(saleRevenueIdempotencyKey(trimmed)),
        stableBusinessEventId(saleCogsIdempotencyKey(trimmed)),
      ];

      const { data, error } = await supabase
        .from("journal_entries")
        .select("id, status, business_event_id")
        .in("business_event_id", eventIds)
        .eq("status", "posted")
        .limit(1);

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
          toUserError(error, "Failed to load sale accounting status"),
        );
      }

      return ok(data && data.length > 0 ? "posted" : "pending");
    } catch (error) {
      return fail(
        toUserError(error, "Failed to load sale accounting status"),
      );
    }
  },
};
