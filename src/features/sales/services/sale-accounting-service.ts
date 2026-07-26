/**
 * Sales → Accounting integration (DEV-093).
 *
 * Maps Sale Completed into Accounting Business Events and submits them
 * through the generic Operational Accounting Integration framework:
 *
 *   sale_completed   → Revenue journal proposal
 *   cogs_recognized  → COGS journal proposal
 *
 * Sales may only:
 *   - emit Business Events (via Event Factory)
 *   - receive Posting Results
 *
 * Does NOT:
 *   - create Journal Entries / Ledger Entries
 *   - resolve Posting Rules (except pass optional test overrides)
 *   - access Accounting SQL
 *   - change Sales UI / hooks
 */

import { createCogsRecognizedPostingRule } from "@/features/accounting/rules/cogs-recognized-posting-rule";
import {
  createSaleCompletedRevenuePostingRule,
  type SaleRevenueDebitRole,
} from "@/features/accounting/rules/sale-completed-posting-rule";
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
  SaleAccountingContext,
  SaleAccountingSource,
  SaleJournalProposals,
} from "../types/sale-accounting";
import type { SaleWithLines } from "../types/sale";

function saleRevenueIdempotencyKey(saleId: string): string {
  return `sale_completed:${saleId}`;
}

function saleCogsIdempotencyKey(saleId: string): string {
  return `cogs_recognized:${saleId}`;
}

function assertNotDuplicate(
  key: string,
  alreadyPosted: readonly string[] | undefined,
): ServiceResult<true> {
  if (alreadyPosted?.includes(key)) {
    return fail("Sale accounting has already been posted for this event.");
  }
  return ok(true);
}

function resolveRevenueRules(
  accounting: SaleAccountingContext,
): readonly PostingRule[] | undefined {
  if (accounting.postingRulesByEvent?.sale_completed !== undefined) {
    return accounting.postingRulesByEvent.sale_completed;
  }

  const debitRole: SaleRevenueDebitRole =
    accounting.revenueDebitRole ?? "accounts_receivable";

  if (debitRole !== "accounts_receivable") {
    return [createSaleCompletedRevenuePostingRule({ debitRole })];
  }

  // undefined → Accounting default registry (accounts_receivable)
  return undefined;
}

function resolveCogsRules(
  accounting: SaleAccountingContext,
): readonly PostingRule[] | undefined {
  return accounting.postingRulesByEvent?.cogs_recognized;
}

/**
 * Build the sale_completed Business Event (revenue facts).
 */
export function buildSaleCompletedBusinessEvent(
  sale: SaleWithLines,
  accounting: Pick<
    SaleAccountingContext,
    | "baseCurrency"
    | "transactionCurrency"
    | "exchangeRate"
    | "rateDate"
    | "nowIso"
    | "createId"
  >,
): ServiceResult<AccountingBusinessEvent> {
  if (sale.status !== "confirmed" && sale.status !== "paid") {
    return fail(
      "Only confirmed or paid sales can emit sale_completed events.",
    );
  }

  if (!(sale.subtotal >= 0) || !Number.isFinite(sale.subtotal)) {
    return fail("Sale subtotal is invalid for accounting.");
  }

  if (
    !accounting.transactionCurrency ||
    accounting.transactionCurrency.trim().length === 0
  ) {
    return fail("Sale transaction currency is required for accounting.");
  }

  return createBusinessEvent({
    event_type: "sale_completed",
    source_module: "sales",
    source_document_type: "sale",
    source_document_id: sale.id,
    transaction_id: null,
    occurred_at: sale.confirmed_at ?? sale.sale_date,
    transaction_currency: accounting.transactionCurrency,
    base_currency: accounting.baseCurrency,
    exchange_rate: accounting.exchangeRate,
    rate_date: accounting.rateDate,
    amounts: {
      gross_amount: sale.total,
      net_amount: sale.subtotal,
      tax_amount: sale.tax_total,
      cogs_amount: null,
      discount_amount: null,
      shipping_amount: null,
      other_amount: null,
    },
    tax_lines: [],
    idempotency_key: saleRevenueIdempotencyKey(sale.id),
    nowIso: accounting.nowIso,
    createId: accounting.createId,
  });
}

/**
 * Build the cogs_recognized Business Event (COGS facts from confirm_sale).
 */
export function buildCogsRecognizedBusinessEvent(
  sale: SaleWithLines,
  totalCogs: number,
  accounting: Pick<
    SaleAccountingContext,
    | "baseCurrency"
    | "transactionCurrency"
    | "exchangeRate"
    | "rateDate"
    | "nowIso"
    | "createId"
  >,
): ServiceResult<AccountingBusinessEvent> {
  if (sale.status !== "confirmed" && sale.status !== "paid") {
    return fail(
      "Only confirmed or paid sales can emit cogs_recognized events.",
    );
  }

  if (!(totalCogs >= 0) || !Number.isFinite(totalCogs)) {
    return fail("Sale COGS is invalid for accounting.");
  }

  if (
    !accounting.transactionCurrency ||
    accounting.transactionCurrency.trim().length === 0
  ) {
    return fail("Sale transaction currency is required for accounting.");
  }

  return createBusinessEvent({
    event_type: "cogs_recognized",
    source_module: "sales",
    source_document_type: "sale",
    source_document_id: sale.id,
    transaction_id: null,
    occurred_at: sale.confirmed_at ?? sale.sale_date,
    transaction_currency: accounting.transactionCurrency,
    base_currency: accounting.baseCurrency,
    exchange_rate: accounting.exchangeRate,
    rate_date: accounting.rateDate,
    amounts: {
      gross_amount: null,
      net_amount: null,
      tax_amount: null,
      cogs_amount: totalCogs,
      discount_amount: null,
      shipping_amount: null,
      other_amount: null,
    },
    tax_lines: [],
    idempotency_key: saleCogsIdempotencyKey(sale.id),
    nowIso: accounting.nowIso,
    createId: accounting.createId,
  });
}

function proposeFromEvent(input: {
  event: AccountingBusinessEvent;
  accounting: SaleAccountingContext;
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

export const saleAccountingService = {
  buildSaleCompletedBusinessEvent,
  buildCogsRecognizedBusinessEvent,
  createSaleCompletedRevenuePostingRule,
  createCogsRecognizedPostingRule,

  /**
   * Emit sale_completed + cogs_recognized through the generic framework.
   * Returns two journal proposals (revenue + COGS). Propose-only.
   */
  proposeJournalsForSaleCompleted(
    source: SaleAccountingSource,
    accounting: SaleAccountingContext,
  ): ServiceResult<SaleJournalProposals> {
    const { sale, total_cogs: totalCogs } = source;

    if (sale.status !== "confirmed" && sale.status !== "paid") {
      return fail(
        "Only confirmed or paid sales can propose accounting journals.",
      );
    }

    const revenueAmount = sale.subtotal;
    const cogsAmount = totalCogs;

    if (
      (!Number.isFinite(revenueAmount) || revenueAmount < 0) ||
      (!Number.isFinite(cogsAmount) || cogsAmount < 0)
    ) {
      return fail("Sale revenue and COGS must be finite non-negative amounts.");
    }

    if (revenueAmount === 0 && cogsAmount === 0) {
      return fail(
        "Sale has zero revenue and zero COGS; nothing to post to Accounting.",
      );
    }

    let revenue: OperationalPostingResult | null = null;
    let cogs: OperationalPostingResult | null = null;

    if (revenueAmount > 0) {
      const dup = assertNotDuplicate(
        saleRevenueIdempotencyKey(sale.id),
        accounting.alreadyPostedIdempotencyKeys,
      );
      if (dup.error) {
        return fail(dup.error);
      }

      const eventResult = buildSaleCompletedBusinessEvent(sale, accounting);
      if (eventResult.error || !eventResult.data) {
        return fail(
          eventResult.error ?? "Failed to build sale_completed business event",
        );
      }

      const proposed = proposeFromEvent({
        event: eventResult.data,
        accounting,
        postingRules: resolveRevenueRules(accounting),
        correlationId: sale.id,
        tags: {
          module: "sales",
          document: "sale",
          journal: "revenue",
        },
      });

      if (proposed.error || !proposed.data) {
        return fail(
          proposed.error ?? "Failed to propose revenue journal for sale",
        );
      }
      revenue = proposed.data;
    }

    if (cogsAmount > 0) {
      const dup = assertNotDuplicate(
        saleCogsIdempotencyKey(sale.id),
        accounting.alreadyPostedIdempotencyKeys,
      );
      if (dup.error) {
        return fail(dup.error);
      }

      const eventResult = buildCogsRecognizedBusinessEvent(
        sale,
        cogsAmount,
        accounting,
      );
      if (eventResult.error || !eventResult.data) {
        return fail(
          eventResult.error ?? "Failed to build cogs_recognized business event",
        );
      }

      const proposed = proposeFromEvent({
        event: eventResult.data,
        accounting,
        postingRules: resolveCogsRules(accounting),
        correlationId: sale.id,
        tags: {
          module: "sales",
          document: "sale",
          journal: "cogs",
        },
      });

      if (proposed.error || !proposed.data) {
        return fail(
          proposed.error ?? "Failed to propose COGS journal for sale",
        );
      }
      cogs = proposed.data;
    }

    return ok({
      sale,
      total_cogs: totalCogs,
      revenue,
      cogs,
    });
  },
};
