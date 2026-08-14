/**
 * Operational Module ↔ Accounting Integration contracts (DEV-092).
 *
 * Operational modules may only:
 *   - emit a Business Event (via Event Factory / module emitter)
 *   - submit a Posting Request
 *   - receive a Posting Result
 *
 * They must never create journals/ledger rows, resolve posting rules,
 * or access Accounting SQL directly.
 *
 * Future-compatible emitters: Purchases, Sales, Production, Inventory,
 * Inventory Adjustments, Waste, Returns, Transfers.
 */

import type {
  Account,
  AccountRoleBinding,
  AccountingBusinessEvent,
  AccountingBusinessEventType,
  FiscalPeriod,
  PostingRule,
} from "@/types/accounting";
import type { PostingResult } from "./posting-engine";
import type {
  PostedJournalProposalStatus,
  PostedJournalRecord,
} from "./posting-persistence";

/**
 * Opaque correlation metadata carried with every posting request/result.
 * Operational modules supply source identity; Accounting echoes it back.
 */
export interface OperationalPostingMetadata {
  source_module: string;
  source_document_type: string;
  source_document_id: string;
  idempotency_key: string;
  /** Optional cross-module correlation id (transaction spine, job id, etc.). */
  correlation_id?: string | null;
  requested_at: string;
  /** Extensible labels for future modules without contract churn. */
  tags?: Readonly<Record<string, string>>;
}

/**
 * Accounting runtime inputs required to process a posting request.
 * Rule lists are optional — Accounting resolves defaults by event type.
 */
export interface OperationalPostingContext {
  fiscalPeriod: FiscalPeriod;
  accountRoleBindings: readonly AccountRoleBinding[];
  accountsById?: Readonly<
    Record<string, Pick<Account, "id" | "is_postable" | "is_active">>
  >;
  /**
   * Optional rule override (tests / advanced configuration).
   * When omitted, Accounting resolves the active default rule set.
   */
  postingRules?: readonly PostingRule[];
  nowIso?: string;
  createId?: () => string;
}

/**
 * propose — build validated Journal Proposal only (no ledger write).
 * post    — propose then persist journal + ledger via Posting Service.
 */
export type OperationalPostingMode = "propose" | "post";

/**
 * Request submitted by an operational module into Accounting.
 */
export interface OperationalPostingRequest {
  event: AccountingBusinessEvent;
  metadata: OperationalPostingMetadata;
  context: OperationalPostingContext;
  mode?: OperationalPostingMode;
}

/**
 * Result returned to the operational module.
 * Journal/ledger persistence details stay inside Accounting.
 */
export interface OperationalPostingResult {
  business_event_id: string;
  event_type: AccountingBusinessEventType;
  mode: OperationalPostingMode;
  metadata: OperationalPostingMetadata;
  /** Validated journal proposal produced by the Posting Engine. */
  journal_proposal: PostingResult;
  /**
   * Populated only when mode === "post".
   * Always null for propose mode (current Purchases behaviour).
   */
  posted_journal: PostedJournalRecord | null;
  /**
   * Per-proposal persistence outcome from post_journal_proposals (sql/091).
   * Null for propose mode (not applicable). For mode === "post" via post(),
   * always "posted_now" — that path fails hard on ALREADY_POSTED, same as
   * before this field existed. For mode === "post" via postMany(), may be
   * "already_posted" when a batch retry finds one proposal already landed
   * from an earlier call — posted_journal stays null in that case too.
   */
  posting_status: PostedJournalProposalStatus | null;
}

/**
 * Re-export the canonical Business Event contract for integration callers.
 */
export type OperationalBusinessEvent = AccountingBusinessEvent;

export type {
  AccountingBusinessEvent,
  AccountingBusinessEventType,
  PostedJournalRecord,
  PostingResult,
};
