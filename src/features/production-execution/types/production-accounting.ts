/**
 * Production → Accounting integration contracts (DEV-094 / DEV-105).
 *
 * Production Completed / Adjusted emit accounting events through the generic
 * Operational Accounting Integration framework.
 *
 * Production supplies frozen money facts + opaque source refs only.
 * Costs come from Production Batch valuation (DEV-103) — never recalculated.
 * Ledger persistence is Accounting-owned via post mode (DEV-105).
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
 * Accounting inputs required to propose / post journals for production events.
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
  /** Frozen session production cost (Σ batch costs). */
  total_cost: number;
  /** Sum of actual produced quantities across session lines / batches. */
  total_produced_quantity: number;
  batch_count?: number;
  /** Production batch ids linked to this posting. */
  batch_ids?: readonly string[];
  /**
   * Session status gate — posting requires completed sessions only.
   */
  session_status: "completed";
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
  /** Linked production batch ids when provided on the source. */
  batch_ids: readonly string[];
}

export type ProductionJournalPosting = ProductionJournalProposal;

export type ProductionCompletedFromSession = Pick<
  CompleteProductionSessionResult,
  | "session_id"
  | "transaction_id"
  | "total_cost"
  | "completed_at"
  | "batch_count"
  | "batch_ids"
> & {
  total_produced_quantity: number;
  session_status: "completed";
};
