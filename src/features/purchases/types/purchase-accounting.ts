/**
 * Purchases → Accounting integration contracts (DEV-090 / DEV-092 / DEV-100).
 *
 * Purchase Confirmed (received) emits purchase_received via the generic
 * Operational Accounting Integration framework, using a precomputed TaxResult.
 *
 * Purchases supplies money facts + opaque source refs only.
 * Accounting never recalculates taxes.
 * Ledger persistence is Accounting-owned via post mode (audit finding #3).
 */

import type {
  Account,
  AccountRoleBinding,
  FiscalPeriod,
  PostingRule,
} from "@/types/accounting";
import type { PostingResult } from "@/features/accounting/types/posting-engine";
import type { OperationalPostingResult } from "@/features/accounting/types/operational-integration";
import type { PurchaseWithRelations } from "./purchase";
import type { PurchaseTaxResult } from "./purchase-tax";

/**
 * Accounting inputs required to propose a journal for a confirmed purchase.
 * Posting rules default inside Accounting when omitted.
 */
export interface PurchaseAccountingContext {
  fiscalPeriod: FiscalPeriod;
  accountRoleBindings: readonly AccountRoleBinding[];
  accountsById?: Readonly<
    Record<string, Pick<Account, "id" | "is_postable" | "is_active">>
  >;
  /** Company base currency for the proposed journal. */
  baseCurrency: string;
  /** Multiply transaction currency → base currency. */
  exchangeRate: number;
  rateDate: string;
  /**
   * Optional override for tests / advanced configuration.
   * When omitted, Accounting resolves the purchase_received default rule.
   */
  postingRules?: readonly PostingRule[];
  /**
   * Test-only hook for simulating an already-posted idempotency key.
   * Never populated by real production code — the actual, sole protection
   * against duplicate posting is the on-DB ALREADY_POSTED check inside
   * post_journal_proposals (business_event_id, sql/091). Present here only
   * for parity with the same test-only pattern in Production/Sales contexts.
   */
  alreadyPostedIdempotencyKeys?: readonly string[];
  nowIso?: string;
  createId?: () => string;
}

export interface PurchaseJournalProposal {
  purchase: PurchaseWithRelations;
  business_event_id: string;
  journalProposal: PostingResult;
  /** Tax facts used for the proposal (never recalculated by Accounting). */
  tax: PurchaseTaxResult;
}

/**
 * Result of persisting (not just proposing) the purchase_received journal.
 * posted_journal / posting_status are null/absent only if post mode was not
 * actually reached (never happens via postJournalForPurchaseReceived, which
 * only ever returns this shape on a successful post).
 */
export interface PurchaseJournalPosting extends PurchaseJournalProposal {
  posted_journal: OperationalPostingResult["posted_journal"];
  posting_status: OperationalPostingResult["posting_status"];
}

export type { PostingResult, PurchaseTaxResult };
