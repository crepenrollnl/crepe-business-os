/**
 * Purchases → Accounting integration (DEV-090 / DEV-092).
 *
 * Emits purchase_received Business Events for confirmed purchases and
 * submits them through the generic Operational Accounting Integration layer.
 *
 * Purchases may only:
 *   - emit a Business Event
 *   - receive a Posting Result
 *
 * Does NOT:
 *   - create Journal Entries / Ledger Entries
 *   - resolve Posting Rules
 *   - access Accounting SQL
 *   - change Purchases UI / hooks
 */

import { operationalAccountingIntegrationService } from "@/features/accounting/services/operational-accounting-integration-service";
import {
  createBusinessEvent,
  createPostingMetadata,
} from "@/features/accounting/utils/business-event-factory";
import type { AccountingBusinessEvent } from "@/types/accounting";
import { fail, ok, type ServiceResult } from "@/types/service";
import type {
  PurchaseAccountingContext,
  PurchaseJournalProposal,
} from "../types/purchase-accounting";
import type { PurchaseWithRelations } from "../types/purchase";
import { createPurchaseReceivedPostingRule } from "./purchase-received-posting-rule";

/**
 * Build the Accounting Business Event for a confirmed (received) purchase.
 */
export function buildPurchaseReceivedBusinessEvent(
  purchase: PurchaseWithRelations,
  accounting: Pick<
    PurchaseAccountingContext,
    "baseCurrency" | "exchangeRate" | "rateDate" | "nowIso" | "createId"
  >,
): ServiceResult<AccountingBusinessEvent> {
  if (purchase.status !== "received") {
    return fail(
      "Only confirmed (received) purchases can emit purchase_received events.",
    );
  }

  if (!(purchase.subtotal >= 0) || !Number.isFinite(purchase.subtotal)) {
    return fail("Purchase subtotal is invalid for accounting.");
  }

  if (!purchase.currency || purchase.currency.trim().length === 0) {
    return fail("Purchase currency is required for accounting.");
  }

  return createBusinessEvent({
    event_type: "purchase_received",
    source_module: "purchases",
    source_document_type: "purchase",
    source_document_id: purchase.id,
    transaction_id: purchase.transaction_id,
    occurred_at: purchase.purchased_at,
    transaction_currency: purchase.currency,
    base_currency: accounting.baseCurrency,
    exchange_rate: accounting.exchangeRate,
    rate_date: accounting.rateDate,
    amounts: {
      gross_amount: purchase.total,
      net_amount: purchase.subtotal,
      tax_amount: purchase.tax_total,
      cogs_amount: null,
      discount_amount: null,
      shipping_amount: null,
      other_amount: null,
    },
    tax_lines: [],
    idempotency_key: `purchase_received:${purchase.id}`,
    nowIso: accounting.nowIso,
    createId: accounting.createId,
  });
}

export const purchaseAccountingService = {
  buildPurchaseReceivedBusinessEvent,

  createPurchaseReceivedPostingRule,

  /**
   * Emit purchase_received through the generic Accounting integration framework.
   * Propose-only — does not write journal_entries or ledger_entries.
   */
  proposeJournalForPurchaseReceived(
    purchase: PurchaseWithRelations,
    accounting: PurchaseAccountingContext,
  ): ServiceResult<PurchaseJournalProposal> {
    const eventResult = buildPurchaseReceivedBusinessEvent(purchase, accounting);
    if (eventResult.error || !eventResult.data) {
      return fail(
        eventResult.error ?? "Failed to build purchase_received business event",
      );
    }

    const event = eventResult.data;
    const requestedAt = accounting.nowIso ?? new Date().toISOString();

    const integration = operationalAccountingIntegrationService.propose({
      event,
      metadata: createPostingMetadata({
        event,
        requested_at: requestedAt,
        correlation_id: purchase.transaction_id,
        tags: {
          module: "purchases",
          document: "purchase",
        },
      }),
      context: {
        fiscalPeriod: accounting.fiscalPeriod,
        accountRoleBindings: accounting.accountRoleBindings,
        accountsById: accounting.accountsById,
        postingRules: accounting.postingRules,
        nowIso: accounting.nowIso,
        createId: accounting.createId,
      },
      mode: "propose",
    });

    if (integration.error || !integration.data) {
      return fail(
        integration.error ?? "Failed to propose journal for purchase_received",
      );
    }

    return ok({
      purchase,
      business_event_id: integration.data.business_event_id,
      journalProposal: integration.data.journal_proposal,
    });
  },
};

export type { PurchaseAccountingContext, PurchaseJournalProposal };
