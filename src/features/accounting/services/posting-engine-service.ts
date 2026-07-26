/**
 * Generic Posting Engine service (DEV-088).
 *
 * Receives an Accounting Business Event and Posting Context, applies
 * configurable Posting Rules, and returns a proposed balanced journal.
 *
 * Does NOT:
 *   - contain Purchases / Sales / Production / Inventory business rules
 *   - auto-post from operational modules
 *   - persist to SQL (persistence / RPC is a later sprint)
 *   - expose UI, hooks, or pages
 */

import { fail, ok, type ServiceResult } from "@/types/service";
import type { AccountingBusinessEvent } from "@/types/accounting";
import type {
  PostingContext,
  PostingResult,
} from "../types/posting-engine";
import { postingErrorMessage } from "../utils/posting-errors";
import { runPostingPipeline } from "../utils/posting-pipeline";

export const postingEngineService = {
  /**
   * Execute the generic posting pipeline for one business event.
   */
  postBusinessEvent(
    event: AccountingBusinessEvent,
    context: PostingContext,
  ): ServiceResult<PostingResult> {
    const result = runPostingPipeline(event, context);

    if (!result.ok) {
      return fail(postingErrorMessage(result.error));
    }

    return ok(result.data);
  },

  /**
   * Structured pipeline entry for callers that need error codes.
   */
  runPipeline: runPostingPipeline,
};
