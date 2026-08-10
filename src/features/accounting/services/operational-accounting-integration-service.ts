/**
 * Operational Accounting Integration Service (DEV-092).
 *
 * Single Accounting intake for operational modules:
 *
 *   Business Event → Posting Request → (propose | post) → Posting Result
 *
 * Accounting alone:
 *   - resolves Posting Rules
 *   - validates posting
 *   - builds Journal Proposal (Posting Engine)
 *   - persists Journal + Ledger (Posting Service) when mode = "post"
 *
 * Operational modules must never write journal_entries / ledger_entries.
 *
 * Does NOT:
 *   - own operational emitters (Purchases / Sales / … call this service)
 *   - expose UI / hooks / pages
 *   - change Reporting
 */

import { fail, ok, type ServiceResult } from "@/types/service";
import type { PostingContext } from "../types/posting-engine";
import type {
  OperationalPostingMode,
  OperationalPostingRequest,
  OperationalPostingResult,
} from "../types/operational-integration";
import { resolvePostingRulesForRequest } from "../utils/default-posting-rules";
import { postingEngineService } from "./posting-engine-service";
import { postingService } from "./posting-service";

function validateRequest(
  request: OperationalPostingRequest,
): ServiceResult<true> {
  if (!request?.event) {
    return fail("Posting request is missing a business event.");
  }

  if (!request.metadata) {
    return fail("Posting request is missing metadata.");
  }

  if (!request.context?.fiscalPeriod) {
    return fail("Posting request is missing fiscal period context.");
  }

  if (!Array.isArray(request.context.accountRoleBindings)) {
    return fail("Posting request is missing account role bindings.");
  }

  const { event, metadata } = request;

  if (event.source_module !== metadata.source_module) {
    return fail(
      "Posting metadata source_module must match the business event.",
    );
  }

  if (event.source_document_type !== metadata.source_document_type) {
    return fail(
      "Posting metadata source_document_type must match the business event.",
    );
  }

  if (event.source_document_id !== metadata.source_document_id) {
    return fail(
      "Posting metadata source_document_id must match the business event.",
    );
  }

  if (event.idempotency_key !== metadata.idempotency_key) {
    return fail(
      "Posting metadata idempotency_key must match the business event.",
    );
  }

  return ok(true);
}

function toEngineContext(request: OperationalPostingRequest): PostingContext {
  const rules = resolvePostingRulesForRequest(
    request.event.event_type,
    request.context.postingRules,
  );

  return {
    fiscalPeriod: request.context.fiscalPeriod,
    accountRoleBindings: request.context.accountRoleBindings,
    accountsById: request.context.accountsById,
    postingRules: rules,
    nowIso: request.context.nowIso,
    createId: request.context.createId,
  };
}

function toResult(input: {
  request: OperationalPostingRequest;
  mode: OperationalPostingMode;
  journalProposal: OperationalPostingResult["journal_proposal"];
  postedJournal: OperationalPostingResult["posted_journal"];
}): OperationalPostingResult {
  return {
    business_event_id: input.request.event.id,
    event_type: input.request.event.event_type,
    mode: input.mode,
    metadata: input.request.metadata,
    journal_proposal: input.journalProposal,
    posted_journal: input.postedJournal,
  };
}

export const operationalAccountingIntegrationService = {
  /**
   * Propose a journal from an operational Business Event.
   * Does not persist journal_entries or ledger_entries.
   */
  propose(
    request: OperationalPostingRequest,
  ): ServiceResult<OperationalPostingResult> {
    const validation = validateRequest(request);
    if (validation.error) {
      return fail(validation.error);
    }

    const pipeline = postingEngineService.runPipeline(
      request.event,
      toEngineContext(request),
    );

    if (!pipeline.ok) {
      return fail(pipeline.error.message);
    }

    return ok(
      toResult({
        request,
        mode: "propose",
        journalProposal: pipeline.data,
        postedJournal: null,
      }),
    );
  },

  /**
   * Propose then persist journal + ledger through Posting Service only.
   */
  async post(
    request: OperationalPostingRequest,
  ): Promise<ServiceResult<OperationalPostingResult>> {
    const proposed = this.propose(request);
    if (proposed.error || !proposed.data) {
      return fail(proposed.error ?? "Failed to propose journal for posting");
    }

    const persisted = await postingService.postJournalProposal(
      proposed.data.journal_proposal,
      {
        postingDate: request.event.occurred_at.slice(0, 10),
        nowIso: request.context.nowIso,
      },
    );

    if (persisted.error || !persisted.data) {
      return fail(persisted.error ?? "Failed to persist journal posting");
    }

    return ok(
      toResult({
        request,
        mode: "post",
        journalProposal: proposed.data.journal_proposal,
        postedJournal: persisted.data,
      }),
    );
  },

  /**
   * Process a posting request using request.mode (default: propose).
   */
  async process(
    request: OperationalPostingRequest,
  ): Promise<ServiceResult<OperationalPostingResult>> {
    const mode: OperationalPostingMode = request.mode ?? "propose";
    if (mode === "post") {
      return this.post({ ...request, mode: "post" });
    }
    return this.propose({ ...request, mode: "propose" });
  },
};
