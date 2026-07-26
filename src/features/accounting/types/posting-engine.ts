/**
 * Generic Posting Engine contracts (DEV-088).
 *
 * No Purchases / Sales / Production / Inventory business rules live here.
 * The engine only applies configurable Posting Rules to Business Events.
 *
 * See docs/ACCOUNTING.md §8–§9, §18.
 */

import type {
  Account,
  AccountRoleBinding,
  AccountingBusinessEvent,
  FiscalPeriod,
  JournalEntry,
  JournalLine,
  LedgerEntry,
  PostingRule,
} from "@/types/accounting";

export type PostingErrorCode =
  | "INVALID_EVENT"
  | "INVALID_CONTEXT"
  | "PERIOD_NOT_OPEN"
  | "EVENT_DATE_OUTSIDE_PERIOD"
  | "RULE_NOT_FOUND"
  | "ACCOUNT_ROLE_UNBOUND"
  | "ACCOUNT_NOT_POSTABLE"
  | "NO_POSTING_LINES"
  | "UNBALANCED_JOURNAL"
  | "ALREADY_POSTED"
  | "INVALID_EXCHANGE_RATE"
  | "CURRENCY_MISMATCH";

export interface PostingError {
  code: PostingErrorCode;
  message: string;
  details?: Record<string, string | number | boolean | null>;
}

/**
 * Runtime configuration supplied to the Posting Engine.
 * Rules and bindings are data — never hardcoded per operational module.
 */
export interface PostingContext {
  fiscalPeriod: FiscalPeriod;
  postingRules: readonly PostingRule[];
  accountRoleBindings: readonly AccountRoleBinding[];
  /**
   * Optional account lookup for postable/active checks.
   * When omitted, role bindings are trusted.
   */
  accountsById?: Readonly<
    Record<string, Pick<Account, "id" | "is_postable" | "is_active">>
  >;
  /** ISO timestamp used for created_at / posted_at on proposed output. */
  nowIso?: string;
  /** Deterministic id factory for tests. */
  createId?: () => string;
}

/**
 * Proposed posting output. Persistence / RPC is out of scope for DEV-088.
 */
export interface PostingResult {
  event_id: string;
  rule_id: string;
  rule_version: number;
  journal_entry: JournalEntry;
  journal_lines: JournalLine[];
  ledger_entries: LedgerEntry[];
}

export type PostingPipelineResult =
  | { ok: true; data: PostingResult }
  | { ok: false; error: PostingError };

export type { AccountingBusinessEvent, PostingRule };
