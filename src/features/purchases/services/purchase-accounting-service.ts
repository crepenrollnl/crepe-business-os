/**
 * Purchases → Accounting integration (DEV-090 / DEV-092 / DEV-100).
 *
 * Flow:
 *   Purchase Tax Result → purchase_received Business Event
 *   → Operational Accounting Integration → Journal Proposal
 *
 * Accounting never recalculates taxes — TaxResult amounts are facts only.
 *
 * Does NOT:
 *   - create Journal Entries / Ledger Entries
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
  PurchaseJournalProposal,
} from "../types/purchase-accounting";
import type { PurchaseTaxResult } from "../types/purchase-tax";
import type { PurchaseWithRelations } from "../types/purchase";
import { createPurchaseReceivedPostingRule } from "./purchase-received-posting-rule";

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
};

export type { PurchaseAccountingContext, PurchaseJournalProposal };
