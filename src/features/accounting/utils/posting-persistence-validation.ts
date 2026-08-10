/**
 * Pre-persist validation for Journal Proposals (DEV-091).
 */

import { roundMoney } from "@/lib/money";
import type {
  Account,
  FiscalPeriod,
} from "@/types/accounting";
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

function toDateOnly(isoOrDate: string): string {
  return isoOrDate.slice(0, 10);
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

export function validateFiscalPeriodForPosting(
  period: FiscalPeriod | null,
  entryDate: string,
): PostingPersistenceValidationResult {
  if (!period) {
    return {
      ok: false,
      error: persistenceError(
        "PERIOD_NOT_OPEN",
        "Fiscal period was not found for posting.",
      ),
    };
  }

  if (period.status !== "open") {
    return {
      ok: false,
      error: persistenceError(
        "PERIOD_NOT_OPEN",
        "Fiscal period is not open for posting.",
        { fiscal_period_id: period.id, status: period.status },
      ),
    };
  }

  const dateOnly = toDateOnly(entryDate);
  if (dateOnly < period.start_date || dateOnly > period.end_date) {
    return {
      ok: false,
      error: persistenceError(
        "EVENT_DATE_OUTSIDE_PERIOD",
        "Posting date is outside the fiscal period range.",
        {
          posting_date: dateOnly,
          period_start: period.start_date,
          period_end: period.end_date,
        },
      ),
    };
  }

  return { ok: true };
}

export function validateAccountsForPosting(
  accountIds: readonly string[],
  accountsById: Readonly<Record<string, Pick<Account, "id" | "is_active" | "is_postable">>>,
): PostingPersistenceValidationResult {
  for (const accountId of accountIds) {
    const account = accountsById[accountId];
    if (!account) {
      return {
        ok: false,
        error: persistenceError(
          "INACTIVE_ACCOUNT",
          "Journal line references an unknown account.",
          { account_id: accountId },
        ),
      };
    }

    if (!account.is_active) {
      return {
        ok: false,
        error: persistenceError(
          "INACTIVE_ACCOUNT",
          "Journal line references an inactive account.",
          { account_id: accountId },
        ),
      };
    }

    if (!account.is_postable) {
      return {
        ok: false,
        error: persistenceError(
          "ACCOUNT_NOT_POSTABLE",
          "Journal line references a non-postable account.",
          { account_id: accountId },
        ),
      };
    }
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
