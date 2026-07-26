/**
 * Production → Accounting integration (DEV-094 / DEV-105).
 *
 * Maps Production Execution outcomes into Accounting Business Events and
 * submits them through the generic Operational Accounting Integration framework:
 *
 *   production_completed → Dr Finished Goods / Cr Raw Materials
 *   production_adjusted  → configurable adjustment (no variance P&L yet)
 *
 * DEV-105 adds post mode (persist journal + ledger) using frozen batch cost.
 *
 * Production may only:
 *   - emit Business Events (via Event Factory)
 *   - receive Posting Results
 *
 * Does NOT:
 *   - write journal_entries / ledger_entries directly
 *   - resolve Posting Rules (except pass optional test overrides)
 *   - recalculate production costs
 *   - implement variance accounting
 *   - change Production UI / hooks
 */

import { createProductionAdjustedPostingRule } from "@/features/accounting/rules/production-adjusted-posting-rule";
import { createProductionCompletedPostingRule } from "@/features/accounting/rules/production-completed-posting-rule";
import { operationalAccountingIntegrationService } from "@/features/accounting/services/operational-accounting-integration-service";
import type { OperationalPostingResult } from "@/features/accounting/types/operational-integration";
import {
  createBusinessEvent,
  createPostingMetadata,
} from "@/features/accounting/utils/business-event-factory";
import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import type {
  AccountingBusinessEvent,
  PostingRule,
} from "@/types/accounting";
import { fail, ok, type ServiceResult } from "@/types/service";
import type {
  ProductionAccountingContext,
  ProductionAdjustedAccountingSource,
  ProductionCompletedAccountingSource,
  ProductionJournalPosting,
  ProductionJournalProposal,
} from "../types/production-accounting";
import type { ProductionAccountingPostingStatus } from "../types/production-session";
import { stableBusinessEventId } from "../utils/stable-business-event-id";

function productionCompletedIdempotencyKey(sessionId: string): string {
  return `production_completed:${sessionId}`;
}

function productionAdjustedIdempotencyKey(
  sessionId: string,
  adjustmentId: string,
): string {
  return `production_adjusted:${sessionId}:${adjustmentId}`;
}

function assertNotDuplicate(
  key: string,
  alreadyPosted: readonly string[] | undefined,
): ServiceResult<true> {
  if (alreadyPosted?.includes(key)) {
    return fail(
      "Production accounting has already been posted for this event.",
    );
  }
  return ok(true);
}

function assertCompletedProductionSource(
  source: ProductionCompletedAccountingSource,
): ServiceResult<true> {
  if (source.session_status !== "completed") {
    return fail(
      "Production accounting posting requires a completed production session.",
    );
  }

  if (!(source.total_produced_quantity > 0)) {
    return fail(
      "Production completed accounting requires a produced quantity greater than zero.",
    );
  }

  if (!Number.isFinite(source.total_cost) || source.total_cost <= 0) {
    return fail(
      "Production completed accounting requires a total cost greater than zero.",
    );
  }

  const batchIds = source.batch_ids ?? [];
  if (batchIds.length === 0) {
    return fail(
      "Production completed accounting requires at least one production batch.",
    );
  }

  return ok(true);
}

function resolveRules(
  accounting: ProductionAccountingContext,
  eventType: "production_completed" | "production_adjusted",
): readonly PostingRule[] | undefined {
  return accounting.postingRulesByEvent?.[eventType];
}

function submitFromEvent(input: {
  event: AccountingBusinessEvent;
  accounting: ProductionAccountingContext;
  postingRules: readonly PostingRule[] | undefined;
  correlationId: string | null;
  tags: Record<string, string>;
  mode: "propose" | "post";
}):
  | ServiceResult<OperationalPostingResult>
  | Promise<ServiceResult<OperationalPostingResult>> {
  const { event, accounting, postingRules, correlationId, tags, mode } = input;
  const requestedAt = accounting.nowIso ?? new Date().toISOString();

  const request = {
    event,
    metadata: createPostingMetadata({
      event,
      requested_at: requestedAt,
      correlation_id: correlationId,
      tags,
    }),
    context: {
      fiscalPeriod: accounting.fiscalPeriod,
      accountRoleBindings: accounting.accountRoleBindings,
      accountsById: accounting.accountsById,
      postingRules,
      nowIso: accounting.nowIso,
      createId: accounting.createId,
    },
    mode,
  } as const;

  if (mode === "post") {
    return operationalAccountingIntegrationService.post(request);
  }

  return operationalAccountingIntegrationService.propose(request);
}

/**
 * Build the production_completed Business Event.
 */
export function buildProductionCompletedBusinessEvent(
  source: ProductionCompletedAccountingSource,
  accounting: Pick<
    ProductionAccountingContext,
    | "baseCurrency"
    | "transactionCurrency"
    | "exchangeRate"
    | "rateDate"
    | "nowIso"
    | "createId"
  >,
): ServiceResult<AccountingBusinessEvent> {
  const sourceCheck = assertCompletedProductionSource(source);
  if (sourceCheck.error) {
    return fail(sourceCheck.error);
  }

  if (
    !accounting.transactionCurrency ||
    accounting.transactionCurrency.trim().length === 0
  ) {
    return fail(
      "Production transaction currency is required for accounting.",
    );
  }

  const idempotencyKey = productionCompletedIdempotencyKey(source.session_id);

  return createBusinessEvent({
    event_type: "production_completed",
    source_module: "production-execution",
    source_document_type: "production_session",
    source_document_id: source.session_id,
    transaction_id: source.transaction_id,
    occurred_at: source.completed_at,
    transaction_currency: accounting.transactionCurrency,
    base_currency: accounting.baseCurrency,
    exchange_rate: accounting.exchangeRate,
    rate_date: accounting.rateDate,
    amounts: {
      gross_amount: null,
      net_amount: null,
      tax_amount: null,
      cogs_amount: null,
      discount_amount: null,
      shipping_amount: null,
      other_amount: source.total_cost,
    },
    tax_lines: [],
    idempotency_key: idempotencyKey,
    event_id: stableBusinessEventId(idempotencyKey),
    nowIso: accounting.nowIso,
    createId: accounting.createId,
  });
}

/**
 * Build the production_adjusted Business Event (no variance P&L yet).
 */
export function buildProductionAdjustedBusinessEvent(
  source: ProductionAdjustedAccountingSource,
  accounting: Pick<
    ProductionAccountingContext,
    | "baseCurrency"
    | "transactionCurrency"
    | "exchangeRate"
    | "rateDate"
    | "nowIso"
    | "createId"
  >,
): ServiceResult<AccountingBusinessEvent> {
  if (
    !(source.adjustment_amount > 0) ||
    !Number.isFinite(source.adjustment_amount)
  ) {
    return fail(
      "Production adjusted accounting requires an adjustment amount greater than zero.",
    );
  }

  if (!source.adjustment_id || source.adjustment_id.trim().length === 0) {
    return fail("Production adjustment id is required for accounting.");
  }

  if (
    !accounting.transactionCurrency ||
    accounting.transactionCurrency.trim().length === 0
  ) {
    return fail(
      "Production transaction currency is required for accounting.",
    );
  }

  const idempotencyKey = productionAdjustedIdempotencyKey(
    source.session_id,
    source.adjustment_id,
  );

  return createBusinessEvent({
    event_type: "production_adjusted",
    source_module: "production-execution",
    source_document_type: "production_adjustment",
    source_document_id: source.adjustment_id,
    transaction_id: source.transaction_id ?? null,
    occurred_at: source.occurred_at,
    transaction_currency: accounting.transactionCurrency,
    base_currency: accounting.baseCurrency,
    exchange_rate: accounting.exchangeRate,
    rate_date: accounting.rateDate,
    amounts: {
      gross_amount: null,
      net_amount: null,
      tax_amount: null,
      cogs_amount: null,
      discount_amount: null,
      shipping_amount: null,
      other_amount: source.adjustment_amount,
    },
    tax_lines: [],
    idempotency_key: idempotencyKey,
    event_id: stableBusinessEventId(idempotencyKey),
    nowIso: accounting.nowIso,
    createId: accounting.createId,
  });
}

function completedTags(
  source: ProductionCompletedAccountingSource,
): Record<string, string> {
  const batchIds = source.batch_ids ?? [];
  return {
    module: "production-execution",
    document: "production_session",
    journal: "production_completed",
    batch_count: String(source.batch_count ?? batchIds.length),
    batch_ids: batchIds.join(","),
  };
}

async function runProductionCompleted(input: {
  source: ProductionCompletedAccountingSource;
  accounting: ProductionAccountingContext;
  mode: "propose" | "post";
}): Promise<ServiceResult<ProductionJournalProposal>> {
  const { source, accounting, mode } = input;

  const sourceCheck = assertCompletedProductionSource(source);
  if (sourceCheck.error) {
    return fail(sourceCheck.error);
  }

  const dup = assertNotDuplicate(
    productionCompletedIdempotencyKey(source.session_id),
    accounting.alreadyPostedIdempotencyKeys,
  );
  if (dup.error) {
    return fail(dup.error);
  }

  const eventResult = buildProductionCompletedBusinessEvent(source, accounting);
  if (eventResult.error || !eventResult.data) {
    return fail(
      eventResult.error ??
        "Failed to build production_completed business event",
    );
  }

  const submitted = await submitFromEvent({
    event: eventResult.data,
    accounting,
    postingRules: resolveRules(accounting, "production_completed"),
    correlationId: source.transaction_id,
    tags: completedTags(source),
    mode,
  });

  if (submitted.error || !submitted.data) {
    return fail(
      submitted.error ??
        `Failed to ${mode} journal for production_completed`,
    );
  }

  return ok({
    source_document_id: source.session_id,
    event_type: "production_completed",
    postingResult: submitted.data,
    batch_ids: [...(source.batch_ids ?? [])],
  });
}

export const productionAccountingService = {
  buildProductionCompletedBusinessEvent,
  buildProductionAdjustedBusinessEvent,
  createProductionCompletedPostingRule,
  createProductionAdjustedPostingRule,

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

  /**
   * Emit production_completed through the generic Accounting integration framework.
   * Propose-only — does not write journal_entries or ledger_entries.
   */
  proposeJournalForProductionCompleted(
    source: ProductionCompletedAccountingSource,
    accounting: ProductionAccountingContext,
  ): ServiceResult<ProductionJournalProposal> {
    // Synchronous path keeps DEV-094 callers unchanged.
    const sourceCheck = assertCompletedProductionSource(source);
    if (sourceCheck.error) {
      return fail(sourceCheck.error);
    }

    const dup = assertNotDuplicate(
      productionCompletedIdempotencyKey(source.session_id),
      accounting.alreadyPostedIdempotencyKeys,
    );
    if (dup.error) {
      return fail(dup.error);
    }

    const eventResult = buildProductionCompletedBusinessEvent(
      source,
      accounting,
    );
    if (eventResult.error || !eventResult.data) {
      return fail(
        eventResult.error ??
          "Failed to build production_completed business event",
      );
    }

    const proposed = operationalAccountingIntegrationService.propose({
      event: eventResult.data,
      metadata: createPostingMetadata({
        event: eventResult.data,
        requested_at: accounting.nowIso ?? new Date().toISOString(),
        correlation_id: source.transaction_id,
        tags: completedTags(source),
      }),
      context: {
        fiscalPeriod: accounting.fiscalPeriod,
        accountRoleBindings: accounting.accountRoleBindings,
        accountsById: accounting.accountsById,
        postingRules: resolveRules(accounting, "production_completed"),
        nowIso: accounting.nowIso,
        createId: accounting.createId,
      },
      mode: "propose",
    });

    if (proposed.error || !proposed.data) {
      return fail(
        proposed.error ??
          "Failed to propose journal for production_completed",
      );
    }

    return ok({
      source_document_id: source.session_id,
      event_type: "production_completed",
      postingResult: proposed.data,
      batch_ids: [...(source.batch_ids ?? [])],
    });
  },

  /**
   * Post production_completed: propose then persist journal + ledger.
   * Uses frozen Production Batch cost — never recalculates.
   * Idempotent via stable business_event_id + Posting Service ALREADY_POSTED.
   */
  async postJournalForProductionCompleted(
    source: ProductionCompletedAccountingSource,
    accounting: ProductionAccountingContext,
  ): Promise<ServiceResult<ProductionJournalPosting>> {
    return runProductionCompleted({ source, accounting, mode: "post" });
  },

  /**
   * Emit production_adjusted through the generic framework.
   * Variance accounting is not implemented — uses configurable capitalization rule.
   */
  proposeJournalForProductionAdjusted(
    source: ProductionAdjustedAccountingSource,
    accounting: ProductionAccountingContext,
  ): ServiceResult<ProductionJournalProposal> {
    const dup = assertNotDuplicate(
      productionAdjustedIdempotencyKey(
        source.session_id,
        source.adjustment_id,
      ),
      accounting.alreadyPostedIdempotencyKeys,
    );
    if (dup.error) {
      return fail(dup.error);
    }

    const eventResult = buildProductionAdjustedBusinessEvent(
      source,
      accounting,
    );
    if (eventResult.error || !eventResult.data) {
      return fail(
        eventResult.error ??
          "Failed to build production_adjusted business event",
      );
    }

    const proposed = operationalAccountingIntegrationService.propose({
      event: eventResult.data,
      metadata: createPostingMetadata({
        event: eventResult.data,
        requested_at: accounting.nowIso ?? new Date().toISOString(),
        correlation_id: source.transaction_id ?? source.session_id,
        tags: {
          module: "production-execution",
          document: "production_adjustment",
          journal: "production_adjusted",
        },
      }),
      context: {
        fiscalPeriod: accounting.fiscalPeriod,
        accountRoleBindings: accounting.accountRoleBindings,
        accountsById: accounting.accountsById,
        postingRules: resolveRules(accounting, "production_adjusted"),
        nowIso: accounting.nowIso,
        createId: accounting.createId,
      },
      mode: "propose",
    });

    if (proposed.error || !proposed.data) {
      return fail(
        proposed.error ??
          "Failed to propose journal for production_adjusted",
      );
    }

    return ok({
      source_document_id: source.adjustment_id,
      event_type: "production_adjusted",
      postingResult: proposed.data,
      batch_ids: [],
    });
  },
};
