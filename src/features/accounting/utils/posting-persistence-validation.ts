/**
 * Pre-persist validation for Journal Proposals (DEV-091).
 *
 * Only the pure, no-DB checks live here — shape and balance can be verified
 * from the proposal alone, so they run as a fast client-side pre-check
 * before post_journal_proposals (sql/091) is even called. Everything that
 * needs to read the database (fiscal period, accounts, currencies,
 * exchange rate, ALREADY_POSTED) moved into that RPC so it runs inside the
 * same transaction as the inserts — see V1 plan item 8.
 */

import { roundMoney } from "@/lib/money";
import type {
  JournalProposal,
  PostingPersistenceError,
  PostingPersistenceValidationResult,
} from "../types/posting-persistence";

function persistenceError(
  code: PostingPersistenceError["code"],
  message: string,
  details?: PostingPersistenceError["details"],
): PostingPersistenceError {
  return details === undefined ? { code, message } : { code, message, details };
}

export function validateJournalProposalShape(
  proposal: JournalProposal,
): PostingPersistenceValidationResult {
  if (!proposal?.journal_entry || !Array.isArray(proposal.journal_lines)) {
    return {
      ok: false,
      error: persistenceError(
        "INVALID_PROPOSAL",
        "Journal proposal is missing journal entry or lines.",
      ),
    };
  }

  if (proposal.journal_lines.length === 0) {
    return {
      ok: false,
      error: persistenceError(
        "INVALID_PROPOSAL",
        "Journal proposal has no journal lines.",
      ),
    };
  }

  if (!proposal.journal_entry.fiscal_period_id) {
    return {
      ok: false,
      error: persistenceError(
        "INVALID_PROPOSAL",
        "Journal proposal is missing fiscal_period_id.",
      ),
    };
  }

  if (
    !proposal.journal_entry.transaction_currency ||
    !proposal.journal_entry.base_currency
  ) {
    return {
      ok: false,
      error: persistenceError(
        "INVALID_PROPOSAL",
        "Journal proposal currencies are required.",
      ),
    };
  }

  if (
    !Number.isFinite(proposal.journal_entry.exchange_rate) ||
    proposal.journal_entry.exchange_rate <= 0
  ) {
    return {
      ok: false,
      error: persistenceError(
        "INVALID_PROPOSAL",
        "Journal proposal exchange_rate must be greater than zero.",
        { exchange_rate: proposal.journal_entry.exchange_rate },
      ),
    };
  }

  return { ok: true };
}

export function validateProposalBalanced(
  proposal: JournalProposal,
): PostingPersistenceValidationResult {
  const debitBase = roundMoney(
    proposal.journal_lines.reduce((sum, line) => sum + line.debit_base, 0),
  );
  const creditBase = roundMoney(
    proposal.journal_lines.reduce((sum, line) => sum + line.credit_base, 0),
  );

  if (debitBase !== creditBase || debitBase <= 0) {
    return {
      ok: false,
      error: persistenceError(
        "UNBALANCED_JOURNAL",
        "Journal proposal is not balanced in base currency.",
        {
          debit_base_total: debitBase,
          credit_base_total: creditBase,
        },
      ),
    };
  }

  return { ok: true };
}

/**
 * Ledger is append-only. Posting Service must never update/delete ledger rows.
 */
export function assertLedgerAppendOnly(
  operation: "update" | "delete",
): never {
  throw new Error(
    `ledger_entries is append-only and does not allow ${operation}.`,
  );
}
