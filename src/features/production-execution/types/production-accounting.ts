/**
 * Production → Accounting integration contracts (DEV-094).
 *
 * Production Completed / Adjusted emit accounting events through the generic
 * Operational Accounting Integration framework.
 *
 * Production supplies money facts + opaque source refs only.
 * Ledger persistence remains Accounting-owned (propose mode by default).
 * Variance accounting is not implemented yet.
 */

import type {
  Account,
  AccountRoleBinding,
  FiscalPeriod,
  PostingRule,
} from "@/types/accounting";
import type { OperationalPostingResult } from "@/features/accounting/types/operational-integration";
import type { CompleteProductionSessionResult } from "./production-batch";

/**
 * Accounting inputs required to propose journals for production events.
 * Posting rules default inside Accounting when omitted.
 */
export interface ProductionAccountingContext {
  fiscalPeriod: FiscalPeriod;
  accountRoleBindings: readonly AccountRoleBinding[];
  accountsById?: Readonly<
    Record<string, Pick<Account, "id" | "is_postable" | "is_active">>
  >;
  baseCurrency: string;
  transactionCurrency: string;
  exchangeRate: number;
  rateDate: string;
  /**
   * Optional rule overrides by event type (tests / future variance config).
   */
  postingRulesByEvent?: Partial<
    Record<"production_completed" | "production_adjusted", readonly PostingRule[]>
  >;
  alreadyPostedIdempotencyKeys?: readonly string[];
  nowIso?: string;
  createId?: () => string;
}

/**
 * Source facts for production.completed accounting.
 * total_cost comes from Production Execution completion — never recalculated here.
 */
export interface ProductionCompletedAccountingSource {
  session_id: string;
  transaction_id: string | null;
  completed_at: string;
  total_cost: number;
  /** Sum of actual produced quantities across session lines / batches. */
  total_produced_quantity: number;
  batch_count?: number;
}

/**
 * Source facts for production.adjusted accounting.
 * Variance P&L mapping is deferred — amount is a cost capitalization adjustment.
 */
export interface ProductionAdjustedAccountingSource {
  session_id: string;
  adjustment_id: string;
  occurred_at: string;
  /** Absolute adjustment amount in transaction currency (> 0 to propose). */
  adjustment_amount: number;
  transaction_id?: string | null;
}

export interface ProductionJournalProposal {
  source_document_id: string;
  event_type: "production_completed" | "production_adjusted";
  postingResult: OperationalPostingResult;
}

export type ProductionCompletedFromSession = Pick<
  CompleteProductionSessionResult,
  | "session_id"
  | "transaction_id"
  | "total_cost"
  | "completed_at"
  | "batch_count"
> & {
  total_produced_quantity: number;
};
