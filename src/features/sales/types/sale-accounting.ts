/**
 * Sales → Accounting integration contracts (DEV-093).
 *
 * Sale Completed emits sale_completed (+ companion cogs_recognized) through
 * the generic Operational Accounting Integration framework.
 *
 * Sales supplies money facts + opaque source refs only.
 * Ledger persistence remains Accounting-owned (propose mode by default).
 */

import type {
  Account,
  AccountRoleBinding,
  FiscalPeriod,
  PostingRule,
} from "@/types/accounting";
import type { OperationalPostingResult } from "@/features/accounting/types/operational-integration";
import type { SaleRevenueDebitRole } from "@/features/accounting/rules/sale-completed-posting-rule";
import type { ConfirmSaleResult, SaleWithLines } from "./sale";

/**
 * Accounting inputs required to propose journals for a completed sale.
 * Posting rules default inside Accounting when omitted.
 */
export interface SaleAccountingContext {
  fiscalPeriod: FiscalPeriod;
  accountRoleBindings: readonly AccountRoleBinding[];
  accountsById?: Readonly<
    Record<string, Pick<Account, "id" | "is_postable" | "is_active">>
  >;
  /** Company base currency for proposed journals. */
  baseCurrency: string;
  /** Sale transaction currency (Sales entity has no currency column yet). */
  transactionCurrency: string;
  /** Multiply transaction currency → base currency. */
  exchangeRate: number;
  rateDate: string;
  /** Dr side for revenue: Accounts Receivable (default) or Cash. */
  revenueDebitRole?: SaleRevenueDebitRole;
  /**
   * Optional rule overrides by event type (tests / advanced configuration).
   * When omitted, Accounting resolves defaults for sale_completed / cogs_recognized.
   */
  postingRulesByEvent?: Partial<
    Record<"sale_completed" | "cogs_recognized", readonly PostingRule[]>
  >;
  /**
   * Idempotency keys already posted for this sale.
   * Used to reject duplicate posting attempts.
   */
  alreadyPostedIdempotencyKeys?: readonly string[];
  nowIso?: string;
  createId?: () => string;
}

/**
 * Combined Sales accounting result: revenue + COGS proposals.
 * Either side may be null when amount is zero and skipped.
 */
export interface SaleJournalProposals {
  sale: SaleWithLines;
  total_cogs: number;
  revenue: OperationalPostingResult | null;
  cogs: OperationalPostingResult | null;
}

export type SaleAccountingSource = ConfirmSaleResult;

export type { SaleRevenueDebitRole };
