/**
 * Accounting Posting Service (DEV-091).
 *
 * Converts a validated Journal Proposal into immutable accounting records:
 *   journal_entries + journal_lines + ledger_entries
 *
 * ONLY this service may persist accounting journals/ledger rows.
 * Posting Engine and operational modules must not write the ledger.
 *
 * Does NOT:
 *   - change Purchases / Sales / Production integrations
 *   - expose UI / hooks / pages
 *   - update or delete posted ledger rows
 */

import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import type {
  Account,
  FiscalPeriod,
  JournalEntry,
  JournalLine,
  LedgerEntry,
} from "@/types/accounting";
import { fail, ok, type ServiceResult } from "@/types/service";
import type {
  JournalProposal,
  PostedJournalRecord,
  PostingPersistenceError,
} from "../types/posting-persistence";
import {
  assertLedgerAppendOnly,
  validateAccountsForPosting,
  validateFiscalPeriodForPosting,
  validateJournalProposalShape,
  validateProposalBalanced,
} from "../utils/posting-persistence-validation";

function toDateOnly(isoOrDate: string): string {
  return isoOrDate.slice(0, 10);
}

function persistenceFail(error: PostingPersistenceError): ServiceResult<never> {
  return fail(error.message);
}

async function findExistingPostedJournal(
  businessEventId: string | null,
  journalEntryId: string,
): Promise<ServiceResult<{ id: string; posting_number: string | null } | null>> {
  if (businessEventId) {
    const { data, error } = await supabase
      .from("journal_entries")
      .select("id, posting_number, status")
      .eq("business_event_id", businessEventId)
      .eq("status", "posted")
      .maybeSingle();

    if (error) {
      return fail(
        toUserError(error, "Failed to check for an existing posted journal"),
      );
    }

    if (data) {
      return ok({
        id: data.id as string,
        posting_number: (data.posting_number as string | null) ?? null,
      });
    }
  }

  const { data, error } = await supabase
    .from("journal_entries")
    .select("id, posting_number, status")
    .eq("id", journalEntryId)
    .maybeSingle();

  if (error) {
    return fail(
      toUserError(error, "Failed to check for an existing posted journal"),
    );
  }

  if (data && data.status === "posted") {
    return ok({
      id: data.id as string,
      posting_number: (data.posting_number as string | null) ?? null,
    });
  }

  return ok(null);
}

async function loadFiscalPeriod(
  fiscalPeriodId: string,
): Promise<ServiceResult<FiscalPeriod | null>> {
  const { data, error } = await supabase
    .from("fiscal_periods")
    .select(
      "id, name, start_date, end_date, status, closed_at, created_at, updated_at",
    )
    .eq("id", fiscalPeriodId)
    .maybeSingle();

  if (error) {
    return fail(toUserError(error, "Failed to load fiscal period"));
  }

  return ok((data as FiscalPeriod | null) ?? null);
}

async function loadAccountsById(
  accountIds: readonly string[],
): Promise<
  ServiceResult<Record<string, Pick<Account, "id" | "is_active" | "is_postable">>>
> {
  const uniqueIds = [...new Set(accountIds)];
  if (uniqueIds.length === 0) {
    return ok({});
  }

  const { data, error } = await supabase
    .from("accounts")
    .select("id, is_active, is_postable")
    .in("id", uniqueIds);

  if (error) {
    return fail(toUserError(error, "Failed to load accounts for posting"));
  }

  const map: Record<string, Pick<Account, "id" | "is_active" | "is_postable">> =
    {};
  for (const row of data ?? []) {
    map[row.id as string] = {
      id: row.id as string,
      is_active: Boolean(row.is_active),
      is_postable: Boolean(row.is_postable),
    };
  }

  return ok(map);
}

async function validateCurrencies(
  transactionCurrency: string,
  baseCurrency: string,
): Promise<ServiceResult<true>> {
  const codes = [...new Set([transactionCurrency, baseCurrency])];
  const { data, error } = await supabase
    .from("currencies")
    .select("code, is_active")
    .in("code", codes);

  if (error) {
    return fail(toUserError(error, "Failed to validate currencies"));
  }

  const activeCodes = new Set(
    (data ?? [])
      .filter((row) => row.is_active === true)
      .map((row) => row.code as string),
  );

  for (const code of codes) {
    if (!activeCodes.has(code)) {
      return persistenceFail({
        code: "INVALID_CURRENCY",
        message: `Currency '${code}' is missing or inactive.`,
        details: { currency: code },
      });
    }
  }

  return ok(true);
}

async function validateExchangeRateAvailable(input: {
  transactionCurrency: string;
  baseCurrency: string;
  exchangeRate: number;
  rateDate: string;
}): Promise<ServiceResult<true>> {
  const {
    transactionCurrency,
    baseCurrency,
    exchangeRate,
    rateDate,
  } = input;

  if (transactionCurrency === baseCurrency) {
    if (exchangeRate !== 1) {
      return persistenceFail({
        code: "MISSING_EXCHANGE_RATE",
        message:
          "Same-currency journals must use exchange_rate = 1 when no FX conversion applies.",
        details: { exchange_rate: exchangeRate },
      });
    }
    return ok(true);
  }

  const { data, error } = await supabase
    .from("currency_rates")
    .select("id, rate")
    .eq("base_currency", baseCurrency)
    .eq("quote_currency", transactionCurrency)
    .eq("rate_date", rateDate)
    .limit(1)
    .maybeSingle();

  if (error) {
    return fail(toUserError(error, "Failed to load exchange rate"));
  }

  if (!data) {
    return persistenceFail({
      code: "MISSING_EXCHANGE_RATE",
      message: "No exchange rate is available for the posting date.",
      details: {
        base_currency: baseCurrency,
        quote_currency: transactionCurrency,
        rate_date: rateDate,
      },
    });
  }

  return ok(true);
}

async function allocatePostingNumber(entryDate: string): Promise<ServiceResult<string>> {
  const year = toDateOnly(entryDate).slice(0, 4);
  const prefix = `JE-${year}-`;

  const { data, error } = await supabase
    .from("journal_entries")
    .select("posting_number")
    .like("posting_number", `${prefix}%`)
    .order("posting_number", { ascending: false })
    .limit(1);

  if (error) {
    return fail(toUserError(error, "Failed to allocate posting number"));
  }

  const latest = data?.[0]?.posting_number as string | undefined;
  let nextSeq = 1;
  if (latest) {
    const raw = latest.slice(prefix.length);
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed >= 1) {
      nextSeq = parsed + 1;
    }
  }

  return ok(`${prefix}${String(nextSeq).padStart(6, "0")}`);
}

function mapJournalRow(row: Record<string, unknown>): JournalEntry {
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

export const postingService = {
  /**
   * Ledger append-only guard. Always throws — no ledger mutations allowed.
   */
  rejectLedgerMutation(operation: "update" | "delete"): never {
    return assertLedgerAppendOnly(operation);
  },

  /**
   * Persist a Journal Proposal as posted journal + ledger rows.
   */
  async postJournalProposal(
    proposal: JournalProposal,
    options?: { postingDate?: string; nowIso?: string },
  ): Promise<ServiceResult<PostedJournalRecord>> {
    try {
      const shape = validateJournalProposalShape(proposal);
      if (!shape.ok) {
        return persistenceFail(shape.error);
      }

      const balanced = validateProposalBalanced(proposal);
      if (!balanced.ok) {
        return persistenceFail(balanced.error);
      }

      const postingDate = toDateOnly(
        options?.postingDate ?? proposal.journal_entry.entry_date,
      );
      const nowIso = options?.nowIso ?? new Date().toISOString();
      const journal = proposal.journal_entry;
      const fiscalPeriodId = journal.fiscal_period_id as string;

      const existing = await findExistingPostedJournal(
        journal.business_event_id,
        journal.id,
      );
      if (existing.error) {
        return fail(existing.error);
      }
      if (existing.data) {
        return persistenceFail({
          code: "ALREADY_POSTED",
          message: "Journal proposal has already been posted.",
          details: {
            journal_entry_id: existing.data.id,
            posting_number: existing.data.posting_number,
          },
        });
      }

      const periodResult = await loadFiscalPeriod(fiscalPeriodId);
      if (periodResult.error) {
        return fail(periodResult.error);
      }
      const periodCheck = validateFiscalPeriodForPosting(
        periodResult.data,
        postingDate,
      );
      if (!periodCheck.ok) {
        return persistenceFail(periodCheck.error);
      }

      const accountIds = proposal.journal_lines.map((line) => line.account_id);
      const accountsResult = await loadAccountsById(accountIds);
      if (accountsResult.error || !accountsResult.data) {
        return fail(accountsResult.error ?? "Failed to load accounts");
      }
      const accountsCheck = validateAccountsForPosting(
        accountIds,
        accountsResult.data,
      );
      if (!accountsCheck.ok) {
        return persistenceFail(accountsCheck.error);
      }

      const currenciesCheck = await validateCurrencies(
        journal.transaction_currency,
        journal.base_currency,
      );
      if (currenciesCheck.error) {
        return fail(currenciesCheck.error);
      }

      const rateCheck = await validateExchangeRateAvailable({
        transactionCurrency: journal.transaction_currency,
        baseCurrency: journal.base_currency,
        exchangeRate: journal.exchange_rate,
        rateDate: postingDate,
      });
      if (rateCheck.error) {
        return fail(rateCheck.error);
      }

      const postingNumberResult = await allocatePostingNumber(postingDate);
      if (postingNumberResult.error || !postingNumberResult.data) {
        return fail(
          postingNumberResult.error ?? "Failed to allocate posting number",
        );
      }
      const postingNumber = postingNumberResult.data;

      const draftJournalRow = {
        id: journal.id,
        business_event_id: journal.business_event_id,
        transaction_id: journal.transaction_id,
        fiscal_period_id: fiscalPeriodId,
        entry_date: postingDate,
        memo: journal.memo,
        status: "draft",
        posting_number: null,
        transaction_currency: journal.transaction_currency,
        base_currency: journal.base_currency,
        exchange_rate: journal.exchange_rate,
        reversal_of_journal_entry_id: journal.reversal_of_journal_entry_id,
        posted_at: null,
        created_at: journal.created_at || nowIso,
      };

      const { error: journalInsertError } = await supabase
        .from("journal_entries")
        .insert(draftJournalRow);

      if (journalInsertError) {
        return fail(
          toUserError(journalInsertError, "Failed to create journal entry"),
        );
      }

      const lineRows = proposal.journal_lines.map((line) => ({
        id: line.id,
        journal_entry_id: journal.id,
        line_no: line.line_no,
        account_id: line.account_id,
        description: line.description,
        debit_transaction: line.debit_transaction,
        credit_transaction: line.credit_transaction,
        debit_base: line.debit_base,
        credit_base: line.credit_base,
        tax_code: line.tax_code,
        created_at: nowIso,
      }));

      const { error: linesInsertError } = await supabase
        .from("journal_lines")
        .insert(lineRows);

      if (linesInsertError) {
        return fail(
          toUserError(linesInsertError, "Failed to create journal lines"),
        );
      }

      const ledgerRows = proposal.ledger_entries.map((entry) => ({
        id: entry.id,
        journal_entry_id: journal.id,
        journal_line_id: entry.journal_line_id,
        fiscal_period_id: fiscalPeriodId,
        account_id: entry.account_id,
        entry_date: postingDate,
        debit_base: entry.debit_base,
        credit_base: entry.credit_base,
        debit_transaction: entry.debit_transaction,
        credit_transaction: entry.credit_transaction,
        transaction_currency: entry.transaction_currency,
        base_currency: entry.base_currency,
        created_at: nowIso,
      }));

      const { error: ledgerInsertError } = await supabase
        .from("ledger_entries")
        .insert(ledgerRows);

      if (ledgerInsertError) {
        return fail(
          toUserError(ledgerInsertError, "Failed to create ledger entries"),
        );
      }

      const { data: postedRow, error: postUpdateError } = await supabase
        .from("journal_entries")
        .update({
          status: "posted",
          posting_number: postingNumber,
          posted_at: nowIso,
          entry_date: postingDate,
        })
        .eq("id", journal.id)
        .eq("status", "draft")
        .select(
          "id, business_event_id, transaction_id, fiscal_period_id, entry_date, memo, status, posting_number, transaction_currency, base_currency, exchange_rate, reversal_of_journal_entry_id, posted_at, created_at",
        )
        .single();

      if (postUpdateError || !postedRow) {
        return fail(
          toUserError(
            postUpdateError,
            "Failed to mark journal entry as posted",
          ),
        );
      }

      const postedJournal = mapJournalRow(postedRow as Record<string, unknown>);
      const postedLines: JournalLine[] = proposal.journal_lines.map((line) => ({
        ...line,
        journal_entry_id: journal.id,
      }));
      const postedLedger: LedgerEntry[] = proposal.ledger_entries.map(
        (entry) => ({
          ...entry,
          journal_entry_id: journal.id,
          fiscal_period_id: fiscalPeriodId,
          entry_date: postingDate,
          created_at: nowIso,
        }),
      );

      return ok({
        journal_entry: postedJournal,
        journal_lines: postedLines,
        ledger_entries: postedLedger,
        posting_number: postingNumber,
        posting_date: postingDate,
        fiscal_period_id: fiscalPeriodId,
      });
    } catch (error) {
      return fail(toUserError(error, "Failed to post journal proposal"));
    }
  },
};
