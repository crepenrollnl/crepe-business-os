/**
 * Best-effort report of a non-fatal Accounting posting failure.
 *
 * Never throws. Never changes the caller's return value. The physical
 * operation has already committed; this only records that the journal
 * step failed, in posting_failures and in Sentry.
 */

import * as Sentry from "@sentry/nextjs";
import { supabase } from "@/lib/supabase";
import type { ReportPostingFailureInput } from "../types/posting-failure";

function sentryTags(input: ReportPostingFailureInput): {
  source_flow: string;
  entity_type: string;
  entity_id: string;
} {
  return {
    source_flow: input.sourceFlow,
    entity_type: input.entityType,
    entity_id: input.entityId,
  };
}

function captureToSentry(
  input: ReportPostingFailureInput,
  rpcError?: unknown,
): void {
  try {
    if (rpcError !== undefined) {
      Sentry.captureException(rpcError, {
        tags: sentryTags(input),
        extra: {
          stage: "record_posting_failure_rpc",
          error_message: input.errorMessage,
          business_event_id: input.businessEventId ?? null,
        },
      });
      return;
    }

    Sentry.captureMessage(
      `Accounting posting failed: ${input.errorMessage}`,
      {
        level: "error",
        tags: sentryTags(input),
        extra: {
          business_event_id: input.businessEventId ?? null,
        },
      },
    );
  } catch {
    // Reporting must never throw.
  }
}

export async function reportPostingFailure(
  input: ReportPostingFailureInput,
): Promise<void> {
  captureToSentry(input);

  try {
    const { error } = await supabase.rpc("record_posting_failure", {
      p_source_flow: input.sourceFlow,
      p_entity_type: input.entityType,
      p_entity_id: input.entityId,
      p_business_event_id: input.businessEventId ?? null,
      p_error_message: input.errorMessage,
    });

    if (error) {
      captureToSentry(input, error);
    }
  } catch (rpcCaught) {
    captureToSentry(input, rpcCaught);
  }
}
