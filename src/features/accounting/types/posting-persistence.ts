/**
 * Journal posting persistence contracts (DEV-091).
 *
 * Posting Service converts a validated Journal Proposal into immutable
 * journal_entries / journal_lines / ledger_entries rows.
 */

import type {
  JournalEntry,
  JournalLine,
  LedgerEntry,
} from "@/types/accounting";
import type { PostingResult } from "./posting-engine";

export type PostingPersistenceErrorCode =
  | "INVALID_PROPOSAL"
  | "UNBALANCED_JOURNAL"
  | "ALREADY_POSTED"
  | "PERIOD_NOT_OPEN"
  | "EVENT_DATE_OUTSIDE_PERIOD"
  | "INACTIVE_ACCOUNT"
  | "ACCOUNT_NOT_POSTABLE"
  | "INVALID_CURRENCY"
  | "MISSING_EXCHANGE_RATE"
  | "PERSISTENCE_FAILED";

export interface PostingPersistenceError {
  code: PostingPersistenceErrorCode;
  message: string;
  details?: Record<string, string | number | boolean | null>;
}

export type PostingPersistenceValidationResult =
  | { ok: true }
  | { ok: false; error: PostingPersistenceError };

/**
 * Result after Posting Service persists a proposal.
 */
export interface PostedJournalRecord {
  journal_entry: JournalEntry;
  journal_lines: JournalLine[];
  ledger_entries: LedgerEntry[];
  posting_number: string;
  posting_date: string;
  fiscal_period_id: string;
}

export type JournalProposal = PostingResult;
