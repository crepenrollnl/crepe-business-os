/**
 * Sales → Accounting integration (DEV-093 / DEV-109).
 *
 * Maps Sale Completed into Accounting Business Events and submits them
 * through the generic Operational Accounting Integration framework:
 *
 *   sale_completed   → Revenue + VAT Output + Cash/AR
 *   cogs_recognized  → COGS + Finished Goods Inventory reduction
 *
 * Uses frozen sale totals and frozen COGS — never recalculates VAT or COGS.
 *
 * Sales may only:
 *   - emit Business Events (via Event Factory)
 *   - receive Posting Results
 *
 * Does NOT:
 *   - resolve Posting Rules (except pass optional test overrides)
 *   - change Sales UI / hooks
 *   - recalculate tax or COGS
 */

import { createCogsRecognizedPostingRule } from "@/features/accounting/rules/cogs-recognized-posting-rule";
import {
  createSaleCompletedRevenuePostingRule,
  type SaleRevenueDebitRole,
} from "@/features/accounting/rules/sale-completed-posting-rule";
import { operationalAccountingIntegrationService } from "@/features/accounting/services/operational-accounting-integration-service";
import type {
  OperationalPostingRequest,
  OperationalPostingResult,
} from "@/features/accounting/types/operational-integration";
import {
  createBusinessEvent,
  createPostingMetadata,
} from "@/features/accounting/utils/business-event-factory";
import { roundMoney } from "@/lib/money";
import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import type {
  AccountingBusinessEvent,
  PostingRule,
} from "@/types/accounting";
import { fail, ok, type ServiceResult } from "@/types/service";
import type {
  SaleAccountingContext,
  SaleAccountingPostingStatus,
  SaleAccountingSource,
  SaleJournalPostings,
  SaleJournalProposals,
} from "../types/sale-accounting";
import type { SaleWithLines } from "../types/sale";
import { stableBusinessEventId } from "../utils/stable-business-event-id";

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
 * Build the sale_completed Business Event (frozen revenue + VAT facts).
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

  if (!(sale.tax_total >= 0) || !Number.isFinite(sale.tax_total)) {
    return fail("Sale tax total is invalid for accounting.");
  }

  if (!(sale.total >= 0) || !Number.isFinite(sale.total)) {
    return fail("Sale total is invalid for accounting.");
  }

  if (
    !accounting.transactionCurrency ||
    accounting.transactionCurrency.trim().length === 0
  ) {
    return fail("Sale transaction currency is required for accounting.");
  }

  const idempotencyKey = saleRevenueIdempotencyKey(sale.id);

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
    idempotency_key: idempotencyKey,
    event_id: stableBusinessEventId(idempotencyKey),
    nowIso: accounting.nowIso,
    createId: accounting.createId,
  });
}

/**
 * Build the cogs_recognized Business Event (frozen COGS from DEV-108).
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

  const idempotencyKey = saleCogsIdempotencyKey(sale.id);

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
    idempotency_key: idempotencyKey,
    event_id: stableBusinessEventId(idempotencyKey),
    nowIso: accounting.nowIso,
    createId: accounting.createId,
  });
}

function buildPostingRequest(input: {
  event: AccountingBusinessEvent;
  accounting: SaleAccountingContext;
  postingRules: readonly PostingRule[] | undefined;
  correlationId: string | null;
  tags: Record<string, string>;
  mode: "propose" | "post";
}): OperationalPostingRequest {
  const { event, accounting, postingRules, correlationId, tags, mode } = input;
  const requestedAt = accounting.nowIso ?? new Date().toISOString();

  return {
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
  };
}

async function runSaleCompleted(input: {
  source: SaleAccountingSource;
  accounting: SaleAccountingContext;
  mode: "propose" | "post";
}): Promise<ServiceResult<SaleJournalProposals>> {
  const { source, accounting, mode } = input;
  const { sale, total_cogs: totalCogs } = source;

  if (sale.status !== "confirmed" && sale.status !== "paid") {
    return fail(
      mode === "post"
        ? "Only confirmed or paid sales can post accounting journals."
        : "Only confirmed or paid sales can propose accounting journals.",
    );
  }

  const revenueAmount = sale.subtotal;
  const cogsAmount = totalCogs;

  if (
    !Number.isFinite(revenueAmount) ||
    revenueAmount < 0 ||
    !Number.isFinite(cogsAmount) ||
    cogsAmount < 0
  ) {
    return fail("Sale revenue and COGS must be finite non-negative amounts.");
  }

  // Sub-cent COGS is treated as a legitimate accounting zero (immaterial
  // rounding), not a real cost to post — this is a deliberate threshold,
  // not a forgotten edge case. Building a cogs_recognized event for it
  // would still hit the Posting Pipeline's own zero-amount line drop and
  // fail with NO_POSTING_LINES (found 12.08.2026, live on dev: sale
  // S-000016, COGS of €0.0029 rounded to €0 and aborted the whole COGS
  // proposal — after Revenue had already posted under the old two-call
  // code). Checking roundMoney(cogsAmount) here means that case never
  // reaches the pipeline at all — it settles as "Revenue only, COGS
  // correctly skipped" instead of an error.
  const hasCogsToPost = roundMoney(cogsAmount) > 0;

  if (revenueAmount === 0 && !hasCogsToPost) {
    return fail(
      "Sale has zero revenue and zero COGS; nothing to post to Accounting.",
    );
  }

  // Phase 1 — propose only (pure, no DB writes). Building both proposals
  // before persisting either means a failure here can never leave a
  // partial post: nothing has touched the database yet, for Revenue or
  // COGS, so it's always safe to bail out with fail().
  let revenueRequest: OperationalPostingRequest | null = null;
  let cogsRequest: OperationalPostingRequest | null = null;
  let revenueProposed: OperationalPostingResult | null = null;
  let cogsProposed: OperationalPostingResult | null = null;

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

    revenueRequest = buildPostingRequest({
      event: eventResult.data,
      accounting,
      postingRules: resolveRevenueRules(accounting),
      correlationId: sale.id,
      tags: {
        module: "sales",
        document: "sale",
        journal: "revenue",
        sale_id: sale.id,
      },
      mode,
    });

    const proposed = operationalAccountingIntegrationService.propose(
      revenueRequest,
    );
    if (proposed.error || !proposed.data) {
      return fail(
        proposed.error ?? `Failed to ${mode} revenue journal for sale`,
      );
    }
    revenueProposed = proposed.data;
  }

  if (hasCogsToPost) {
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

    cogsRequest = buildPostingRequest({
      event: eventResult.data,
      accounting,
      postingRules: resolveCogsRules(accounting),
      correlationId: sale.id,
      tags: {
        module: "sales",
        document: "sale",
        journal: "cogs",
        sale_id: sale.id,
      },
      mode,
    });

    const proposed = operationalAccountingIntegrationService.propose(
      cogsRequest,
    );
    if (proposed.error || !proposed.data) {
      return fail(proposed.error ?? `Failed to ${mode} COGS journal for sale`);
    }
    cogsProposed = proposed.data;
  }

  if (mode === "propose") {
    return ok({
      sale,
      total_cogs: totalCogs,
      revenue: revenueProposed,
      cogs: cogsProposed,
    });
  }

  // Phase 2 — persist everything proposed above in a single atomic call.
  // Whatever was built in phase 1 lands together, or none of it does.
  const requestsToPersist: OperationalPostingRequest[] = [];
  if (revenueRequest) {
    requestsToPersist.push(revenueRequest);
  }
  if (cogsRequest) {
    requestsToPersist.push(cogsRequest);
  }

  const persisted = await operationalAccountingIntegrationService.postMany(
    requestsToPersist,
  );
  if (persisted.error || !persisted.data) {
    return fail(persisted.error ?? "Failed to post journals for sale");
  }

  let resultIndex = 0;
  const revenue = revenueRequest ? persisted.data[resultIndex++] : null;
  const cogs = cogsRequest ? persisted.data[resultIndex++] : null;

  return ok({
    sale,
    total_cogs: totalCogs,
    revenue,
    cogs,
  });
}

export const saleAccountingService = {
  buildSaleCompletedBusinessEvent,
  buildCogsRecognizedBusinessEvent,
  createSaleCompletedRevenuePostingRule,
  createCogsRecognizedPostingRule,

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

  /**
   * Emit sale_completed + cogs_recognized through the generic framework.
   * Returns two journal proposals (revenue + COGS). Propose-only.
   */
  proposeJournalsForSaleCompleted(
    source: SaleAccountingSource,
    accounting: SaleAccountingContext,
  ): ServiceResult<SaleJournalProposals> {
    // Sync propose path (DEV-093) — post mode is async via postJournalsForSaleCompleted.
    const { sale, total_cogs: totalCogs } = source;

    if (sale.status !== "confirmed" && sale.status !== "paid") {
      return fail(
        "Only confirmed or paid sales can propose accounting journals.",
      );
    }

    const revenueAmount = sale.subtotal;
    const cogsAmount = totalCogs;

    if (
      !Number.isFinite(revenueAmount) ||
      revenueAmount < 0 ||
      !Number.isFinite(cogsAmount) ||
      cogsAmount < 0
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

      const revenueRequest = buildPostingRequest({
        event: eventResult.data,
        accounting,
        postingRules: resolveRevenueRules(accounting),
        correlationId: sale.id,
        tags: {
          module: "sales",
          document: "sale",
          journal: "revenue",
          sale_id: sale.id,
        },
        mode: "propose",
      });
      const proposed = operationalAccountingIntegrationService.propose(
        revenueRequest,
      );

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
          eventResult.error ??
            "Failed to build cogs_recognized business event",
        );
      }

      const cogsRequest = buildPostingRequest({
        event: eventResult.data,
        accounting,
        postingRules: resolveCogsRules(accounting),
        correlationId: sale.id,
        tags: {
          module: "sales",
          document: "sale",
          journal: "cogs",
          sale_id: sale.id,
        },
        mode: "propose",
      });
      const proposed = operationalAccountingIntegrationService.propose(
        cogsRequest,
      );

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

  /**
   * Post sale_completed + cogs_recognized: propose then persist journals.
   * Uses frozen sale totals and frozen COGS — never recalculates.
   * Idempotent via stable business_event_id + Posting Service ALREADY_POSTED.
   */
  async postJournalsForSaleCompleted(
    source: SaleAccountingSource,
    accounting: SaleAccountingContext,
  ): Promise<ServiceResult<SaleJournalPostings>> {
    return runSaleCompleted({ source, accounting, mode: "post" });
  },
};
