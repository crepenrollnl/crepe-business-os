/**
 * Purchases → Accounting integration contracts (DEV-090 / DEV-092 / DEV-100).
 *
 * Purchase Confirmed (received) emits purchase_received via the generic
 * Operational Accounting Integration framework, using a precomputed TaxResult.
 *
 * Purchases supplies money facts + opaque source refs only.
 * Accounting never recalculates taxes.
 * Ledger persistence remains Accounting-owned (propose mode today).
 */

import type {
  Account,
  AccountRoleBinding,
  FiscalPeriod,
  PostingRule,
} from "@/types/accounting";
import type { PostingResult } from "@/features/accounting/types/posting-engine";
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

export type { PostingResult, PurchaseTaxResult };
