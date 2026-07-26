/**
 * Production → Accounting integration (DEV-094).
 *
 * Maps Production Execution outcomes into Accounting Business Events and
 * submits them through the generic Operational Accounting Integration framework:
 *
 *   production_completed → Dr Finished Goods / Cr Raw Materials
 *   production_adjusted  → configurable adjustment (no variance P&L yet)
 *
 * Production may only:
 *   - emit Business Events (via Event Factory)
 *   - receive Posting Results
 *
 * Does NOT:
 *   - create Journal Entries / Ledger Entries
 *   - resolve Posting Rules (except pass optional test overrides)
 *   - access Accounting SQL
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
import type {
  AccountingBusinessEvent,
  PostingRule,
} from "@/types/accounting";
import { fail, ok, type ServiceResult } from "@/types/service";
import type {
  ProductionAccountingContext,
  ProductionAdjustedAccountingSource,
  ProductionCompletedAccountingSource,
  ProductionJournalProposal,
} from "../types/production-accounting";

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

function resolveRules(
  accounting: ProductionAccountingContext,
  eventType: "production_completed" | "production_adjusted",
): readonly PostingRule[] | undefined {
  return accounting.postingRulesByEvent?.[eventType];
}

function proposeFromEvent(input: {
  event: AccountingBusinessEvent;
  accounting: ProductionAccountingContext;
  postingRules: readonly PostingRule[] | undefined;
  correlationId: string | null;
  tags: Record<string, string>;
}): ServiceResult<OperationalPostingResult> {
  const { event, accounting, postingRules, correlationId, tags } = input;
  const requestedAt = accounting.nowIso ?? new Date().toISOString();

  return operationalAccountingIntegrationService.propose({
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
    mode: "propose",
  });
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
  if (!(source.total_produced_quantity > 0)) {
    return fail(
      "Production completed accounting requires a produced quantity greater than zero.",
    );
  }

  if (!(source.total_cost > 0) || !Number.isFinite(source.total_cost)) {
    return fail(
      "Production completed accounting requires a total cost greater than zero.",
    );
  }

  if (
    !accounting.transactionCurrency ||
    accounting.transactionCurrency.trim().length === 0
  ) {
    return fail(
      "Production transaction currency is required for accounting.",
    );
  }

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
    idempotency_key: productionCompletedIdempotencyKey(source.session_id),
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
    idempotency_key: productionAdjustedIdempotencyKey(
      source.session_id,
      source.adjustment_id,
    ),
    nowIso: accounting.nowIso,
    createId: accounting.createId,
  });
}

export const productionAccountingService = {
  buildProductionCompletedBusinessEvent,
  buildProductionAdjustedBusinessEvent,
  createProductionCompletedPostingRule,
  createProductionAdjustedPostingRule,

  /**
   * Emit production_completed through the generic Accounting integration framework.
   * Propose-only — does not write journal_entries or ledger_entries.
   */
  proposeJournalForProductionCompleted(
    source: ProductionCompletedAccountingSource,
    accounting: ProductionAccountingContext,
  ): ServiceResult<ProductionJournalProposal> {
    if (!(source.total_produced_quantity > 0)) {
      return fail(
        "Production completed accounting requires a produced quantity greater than zero.",
      );
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

    const proposed = proposeFromEvent({
      event: eventResult.data,
      accounting,
      postingRules: resolveRules(accounting, "production_completed"),
      correlationId: source.transaction_id,
      tags: {
        module: "production-execution",
        document: "production_session",
        journal: "production_completed",
      },
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
    });
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

    const proposed = proposeFromEvent({
      event: eventResult.data,
      accounting,
      postingRules: resolveRules(accounting, "production_adjusted"),
      correlationId: source.transaction_id ?? source.session_id,
      tags: {
        module: "production-execution",
        document: "production_adjustment",
        journal: "production_adjusted",
      },
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
    });
  },
};
