/**
 * Accounting Posting Service (DEV-091, extended for V1 plan item 8).
 *
 * Converts one or more validated Journal Proposals into immutable
 * accounting records (journal_entries + journal_lines + ledger_entries) via
 * post_journal_proposals (sql/091) — a single atomic RPC call: every
 * proposal in the batch lands, or none do.
 *
 * ONLY this service may persist accounting journals/ledger rows.
 * Posting Engine and operational modules must not write the ledger.
 *
 * Does NOT:
 *   - change Purchases / Sales / Production integrations
 *   - expose UI / hooks / pages
 *   - update or delete posted ledger rows
 *   - resolve Posting Rules or account-role bindings (that stays in TS,
 *     already-resolved proposals are the only input this service accepts)
 */

import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import type { JournalEntry, JournalLine, LedgerEntry } from "@/types/accounting";
import { fail, ok, type ServiceResult } from "@/types/service";
import type {
  JournalProposal,
  PostedJournalProposalOutcome,
  PostedJournalRecord,
} from "../types/posting-persistence";
import {
  assertLedgerAppendOnly,
  validateJournalProposalShape,
  validateProposalBalanced,
} from "../utils/posting-persistence-validation";

function toDateOnly(isoOrDate: string): string {
  return isoOrDate.slice(0, 10);
}

function mapJournalEntry(row: Record<string, unknown>): JournalEntry {
  return {
    id: row.id as string,
    business_event_id: (row.business_event_id as string | null) ?? null,
    transaction_id: (row.transaction_id as string | null) ?? null,
    fiscal_period_id: (row.fiscal_period_id as string | null) ?? null,
    entry_date: row.entry_date as string,
    memo: (row.memo as string | null) ?? null,
    status: row.status as JournalEntry["status"],
    posting_number: (row.posting_number as string | null) ?? null,
    transaction_currency: row.transaction_currency as string,
    base_currency: row.base_currency as string,
    exchange_rate: Number(row.exchange_rate),
    reversal_of_journal_entry_id:
      (row.reversal_of_journal_entry_id as string | null) ?? null,
    posted_at: (row.posted_at as string | null) ?? null,
    created_at: row.created_at as string,
  };
}

function mapJournalLine(row: Record<string, unknown>): JournalLine {
  return {
    id: row.id as string,
    journal_entry_id: row.journal_entry_id as string,
    line_no: Number(row.line_no),
    account_id: row.account_id as string,
    description: (row.description as string | null) ?? null,
    debit_transaction: Number(row.debit_transaction),
    credit_transaction: Number(row.credit_transaction),
    debit_base: Number(row.debit_base),
    credit_base: Number(row.credit_base),
    tax_code: (row.tax_code as string | null) ?? null,
  };
}

function mapLedgerEntry(row: Record<string, unknown>): LedgerEntry {
  return {
    id: row.id as string,
    journal_entry_id: row.journal_entry_id as string,
    journal_line_id: row.journal_line_id as string,
    fiscal_period_id: row.fiscal_period_id as string,
    account_id: row.account_id as string,
    entry_date: row.entry_date as string,
    debit_base: Number(row.debit_base),
    credit_base: Number(row.credit_base),
    debit_transaction: Number(row.debit_transaction),
    credit_transaction: Number(row.credit_transaction),
    transaction_currency: row.transaction_currency as string,
    base_currency: row.base_currency as string,
    created_at: row.created_at as string,
  };
}

function mapOutcome(row: Record<string, unknown>): PostedJournalProposalOutcome {
  const status = row.status as PostedJournalProposalOutcome["status"];
  const businessEventId = (row.business_event_id as string | null) ?? null;
  const journalEntryId = row.journal_entry_id as string;
  const postingNumber = (row.posting_number as string | null) ?? null;

  if (status !== "posted_now") {
    return {
      status,
      business_event_id: businessEventId,
      journal_entry_id: journalEntryId,
      posting_number: postingNumber,
      record: null,
    };
  }

  const journalEntryRow = row.journal_entry as Record<string, unknown>;
  const journalLineRows = (row.journal_lines as Record<string, unknown>[]) ?? [];
  const ledgerEntryRows = (row.ledger_entries as Record<string, unknown>[]) ?? [];

  const record: PostedJournalRecord = {
    journal_entry: mapJournalEntry(journalEntryRow),
    journal_lines: journalLineRows.map(mapJournalLine),
    ledger_entries: ledgerEntryRows.map(mapLedgerEntry),
    posting_number: postingNumber ?? "",
    posting_date: row.posting_date as string,
    fiscal_period_id: row.fiscal_period_id as string,
  };

  return {
    status,
    business_event_id: businessEventId,
    journal_entry_id: journalEntryId,
    posting_number: postingNumber,
    record,
  };
}

export const postingService = {
  /**
   * Ledger append-only guard. Always throws — no ledger mutations allowed.
   */
  rejectLedgerMutation(operation: "update" | "delete"): never {
    return assertLedgerAppendOnly(operation);
  },

  /**
   * Persist one or more Journal Proposals atomically via post_journal_proposals
   * (sql/091): every proposal in the batch is posted, or none are. A
   * proposal whose business_event_id (or journal id) is already posted is
   * reported as 'already_posted' in the corresponding result element rather
   * than failing the whole batch — see sql/091 for why.
   *
   * Fiscal period / account / currency / exchange-rate / ALREADY_POSTED
   * checks all run inside the RPC, in the same transaction as the inserts.
   * Only shape and balance are pre-checked here (pure, no DB access) to
   * fail fast before the round trip.
   */
  async postJournalProposals(
    proposals: readonly JournalProposal[],
    options?: { postingDate?: string; nowIso?: string },
  ): Promise<ServiceResult<PostedJournalProposalOutcome[]>> {
    try {
      if (proposals.length === 0) {
        return fail("At least one journal proposal is required.");
      }

      for (const proposal of proposals) {
        const shape = validateJournalProposalShape(proposal);
        if (!shape.ok) {
          return fail(shape.error.message);
        }

        const balanced = validateProposalBalanced(proposal);
        if (!balanced.ok) {
          return fail(balanced.error.message);
        }
      }

      const postingDate = toDateOnly(
        options?.postingDate ?? proposals[0].journal_entry.entry_date,
      );
      const nowIso = options?.nowIso ?? new Date().toISOString();

      const payload = proposals.map((proposal) => ({
        journal_entry: proposal.journal_entry,
        journal_lines: proposal.journal_lines,
        ledger_entries: proposal.ledger_entries,
      }));

      const { data, error } = await supabase.rpc("post_journal_proposals", {
        p_proposals: payload,
        p_posting_date: postingDate,
        p_now: nowIso,
      });

      if (error) {
        return fail(toUserError(error, "Failed to post journal proposals"));
      }

      const rows = (data as Record<string, unknown>[] | null) ?? [];
      if (rows.length !== proposals.length) {
        return fail(
          "Posting service returned an unexpected number of results.",
        );
      }

      return ok(rows.map(mapOutcome));
    } catch (error) {
      return fail(toUserError(error, "Failed to post journal proposals"));
    }
  },

  /**
   * Persist a single Journal Proposal. Thin wrapper around
   * postJournalProposals([proposal]) — kept for callers that only ever post
   * one proposal per business event (Production). ALREADY_POSTED is
   * surfaced as a failure here, matching this function's historical
   * (pre-batch) contract — callers that need to tolerate ALREADY_POSTED as
   * a non-fatal outcome across a batch should call postJournalProposals
   * directly.
   */
  async postJournalProposal(
    proposal: JournalProposal,
    options?: { postingDate?: string; nowIso?: string },
  ): Promise<ServiceResult<PostedJournalRecord>> {
    const result = await this.postJournalProposals([proposal], options);
    if (result.error || !result.data) {
      return fail(result.error ?? "Failed to post journal proposal");
    }

    const outcome = result.data[0];
    if (!outcome) {
      return fail("Failed to post journal proposal");
    }

    if (outcome.status === "already_posted") {
      return fail("Journal proposal has already been posted.");
    }

    if (!outcome.record) {
      return fail("Failed to post journal proposal");
    }

    return ok(outcome.record);
  },
};
