/**
 * Purchases → Accounting integration (DEV-090 / DEV-092 / DEV-100).
 *
 * Flow:
 *   Purchase Tax Result → purchase_received Business Event
 *   → Operational Accounting Integration → Journal Proposal
 *
 * Accounting never recalculates taxes — TaxResult amounts are facts only.
 *
 * Audit finding #3 (2026-09) adds post mode (persist journal + ledger) —
 * Receive is the physical operation and is never rolled back if posting
 * fails; postJournalForPurchaseReceived only ever reports a posting
 * failure back to the caller, it does not undo the receive.
 *
 * Purchases may only:
 *   - emit Business Events (via Event Factory)
 *   - receive Posting Results
 *
 * Does NOT:
 *   - write journal_entries / ledger_entries directly
 *   - resolve Posting Rules (except optional test overrides)
 *   - access Accounting SQL / Tax Engine
 *   - change Purchases UI
 */

import { operationalAccountingIntegrationService } from "@/features/accounting/services/operational-accounting-integration-service";
import {
  createBusinessEvent,
  createPostingMetadata,
} from "@/features/accounting/utils/business-event-factory";
import type {
  AccountingBusinessEvent,
  AccountingEventTaxLine,
} from "@/types/accounting";
import { fail, ok, type ServiceResult } from "@/types/service";
import type {
  PurchaseAccountingContext,
  PurchaseJournalPosting,
  PurchaseJournalProposal,
} from "../types/purchase-accounting";
import type { PurchaseTaxResult } from "../types/purchase-tax";
import type { PurchaseWithRelations } from "../types/purchase";
import { createPurchaseReceivedPostingRule } from "./purchase-received-posting-rule";
import { stableBusinessEventId } from "../utils/stable-business-event-id";

function purchaseReceivedIdempotencyKey(purchaseId: string): string {
  return `purchase_received:${purchaseId}`;
}

function assertNotDuplicate(
  key: string,
  alreadyPosted: readonly string[] | undefined,
): ServiceResult<true> {
  if (alreadyPosted?.includes(key)) {
    return fail("Purchase accounting has already been posted for this event.");
  }
  return ok(true);
}

function mapTaxResultToEventTaxLines(
  tax: PurchaseTaxResult,
): AccountingEventTaxLine[] {
  return tax.tax_result.breakdown.lines.map((line) => ({
    tax_code: line.tax_code,
    // Purchases are input-side; map neutral regimes (RC/KOR/zero) as input facts.
    direction: line.direction === "output" ? "output" : "input",
    rate: line.rate_value,
    net_amount: line.net_amount,
    tax_amount: line.tax_amount,
  }));
}

function assertUsableTaxResult(
  tax: PurchaseTaxResult | null | undefined,
): ServiceResult<PurchaseTaxResult> {
  if (!tax) {
    return fail(
      "Tax result is required for purchase accounting. Calculate taxes before proposing a journal.",
    );
  }

  if (!tax.is_valid) {
    return fail("Tax result is invalid and cannot be used for accounting.");
  }

  if (tax.mode === "validate") {
    return fail(
      "Tax validation-only results cannot be used for purchase accounting proposals.",
    );
  }

  if (
    !Number.isFinite(tax.subtotal) ||
    !Number.isFinite(tax.tax_total) ||
    !Number.isFinite(tax.grand_total)
  ) {
    return fail("Tax result amounts are invalid for accounting.");
  }

  if (tax.subtotal < 0 || tax.tax_total < 0 || tax.grand_total < 0) {
    return fail("Tax result amounts must not be negative.");
  }

  return ok(tax);
}

/**
 * Build the Accounting Business Event for a confirmed (received) purchase.
 * Amounts and tax_lines come from the provided TaxResult — never recalculated.
 */
export function buildPurchaseReceivedBusinessEvent(
  purchase: PurchaseWithRelations,
  accounting: Pick<
    PurchaseAccountingContext,
    "baseCurrency" | "exchangeRate" | "rateDate" | "nowIso" | "createId"
  >,
  tax: PurchaseTaxResult,
): ServiceResult<AccountingBusinessEvent> {
  if (purchase.status !== "received") {
    return fail(
      "Only confirmed (received) purchases can emit purchase_received events.",
    );
  }

  const taxCheck = assertUsableTaxResult(tax);
  if (taxCheck.error || !taxCheck.data) {
    return fail(taxCheck.error ?? "Tax result is required for accounting.");
  }

  if (!purchase.currency || purchase.currency.trim().length === 0) {
    return fail("Purchase currency is required for accounting.");
  }

  const taxResult = taxCheck.data;
  const idempotencyKey = purchaseReceivedIdempotencyKey(purchase.id);

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
      gross_amount: taxResult.grand_total,
      net_amount: taxResult.subtotal,
      tax_amount: taxResult.tax_total,
      cogs_amount: null,
      discount_amount: null,
      shipping_amount: null,
      other_amount: null,
    },
    tax_lines: mapTaxResultToEventTaxLines(taxResult),
    idempotency_key: idempotencyKey,
    event_id: stableBusinessEventId(idempotencyKey),
    nowIso: accounting.nowIso,
    createId: accounting.createId,
  });
}

export const purchaseAccountingService = {
  buildPurchaseReceivedBusinessEvent,

  createPurchaseReceivedPostingRule,

  /**
   * Emit purchase_received through the generic Accounting integration framework.
   * Requires a precomputed PurchaseTaxResult — does not call Tax services.
   * Propose-only — does not write journal_entries or ledger_entries.
   */
  proposeJournalForPurchaseReceived(
    purchase: PurchaseWithRelations,
    accounting: PurchaseAccountingContext,
    tax: PurchaseTaxResult,
  ): ServiceResult<PurchaseJournalProposal> {
    const eventResult = buildPurchaseReceivedBusinessEvent(
      purchase,
      accounting,
      tax,
    );
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
          tax_mode: tax.mode,
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
      tax,
    });
  },

  /**
   * Post purchase_received: propose then persist journal + ledger.
   * Uses the precomputed TaxResult — never recalculates.
   * Idempotent via stable business_event_id + Posting Service ALREADY_POSTED.
   */
  async postJournalForPurchaseReceived(
    purchase: PurchaseWithRelations,
    accounting: PurchaseAccountingContext,
    tax: PurchaseTaxResult,
  ): Promise<ServiceResult<PurchaseJournalPosting>> {
    const dup = assertNotDuplicate(
      purchaseReceivedIdempotencyKey(purchase.id),
      accounting.alreadyPostedIdempotencyKeys,
    );
    if (dup.error) {
      return fail(dup.error);
    }

    const eventResult = buildPurchaseReceivedBusinessEvent(
      purchase,
      accounting,
      tax,
    );
    if (eventResult.error || !eventResult.data) {
      return fail(
        eventResult.error ?? "Failed to build purchase_received business event",
      );
    }

    const event = eventResult.data;
    const requestedAt = accounting.nowIso ?? new Date().toISOString();

    const posted = await operationalAccountingIntegrationService.post({
      event,
      metadata: createPostingMetadata({
        event,
        requested_at: requestedAt,
        correlation_id: purchase.transaction_id,
        tags: {
          module: "purchases",
          document: "purchase",
          tax_mode: tax.mode,
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
      mode: "post",
    });

    if (posted.error || !posted.data) {
      return fail(
        posted.error ?? "Failed to post journal for purchase_received",
      );
    }

    return ok({
      purchase,
      business_event_id: posted.data.business_event_id,
      journalProposal: posted.data.journal_proposal,
      posted_journal: posted.data.posted_journal,
      posting_status: posted.data.posting_status,
      tax,
    });
  },
};

export type { PurchaseAccountingContext, PurchaseJournalPosting, PurchaseJournalProposal };
