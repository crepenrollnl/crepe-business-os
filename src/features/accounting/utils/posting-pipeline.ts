/**
 * Generic Posting Pipeline (DEV-088).
 *
 * Business Event + Posting Context + Posting Rules
 *   → validated Journal Entry + Journal Lines + Ledger Entries
 *
 * No operational-module logic. No database writes.
 */

import { roundMoney } from "@/lib/money";
import type {
  AccountingBusinessEvent,
  JournalEntry,
  JournalLine,
  LedgerEntry,
  PostingRule,
  PostingRuleLine,
} from "@/types/accounting";
import type {
  PostingContext,
  PostingPipelineResult,
  PostingResult,
} from "../types/posting-engine";
import { postingError } from "./posting-errors";
import {
  resolveAccountIdForRole,
  resolveActivePostingRule,
  validateBalancedBaseAmounts,
  validateBusinessEvent,
  validateFiscalPeriodForEvent,
  validatePostingContext,
} from "./posting-validation";

function toDateOnly(isoOrDate: string): string {
  return isoOrDate.slice(0, 10);
}

function defaultCreateId(): string {
  return crypto.randomUUID();
}

function readAmount(
  event: AccountingBusinessEvent,
  field: PostingRuleLine["amount_field"],
): number | null {
  const value = event.amounts[field];
  if (value === null || value === 0) {
    return null;
  }
  return value;
}

function buildProposedLines(input: {
  event: AccountingBusinessEvent;
  rule: PostingRule;
  context: PostingContext;
  journalEntryId: string;
  createId: () => string;
}): { lines: JournalLine[] } | PostingPipelineResult {
  const { event, rule, context, journalEntryId, createId } = input;
  const eventDate = toDateOnly(event.occurred_at);
  const sortedRuleLines = [...rule.lines].sort((a, b) => a.line_no - b.line_no);
  const lines: JournalLine[] = [];
  let outputLineNo = 1;

  for (const ruleLine of sortedRuleLines) {
    const sourceAmount = readAmount(event, ruleLine.amount_field);
    if (sourceAmount === null) {
      continue;
    }

    const accountIdOrError = resolveAccountIdForRole(
      ruleLine.account_role,
      eventDate,
      context.accountRoleBindings,
    );
    if (typeof accountIdOrError !== "string") {
      return { ok: false, error: accountIdOrError };
    }

    const account = context.accountsById?.[accountIdOrError];
    if (account) {
      if (!account.is_active) {
        return {
          ok: false,
          error: postingError(
            "ACCOUNT_NOT_POSTABLE",
            "Bound account is inactive and cannot be posted to.",
            { account_id: account.id, role: ruleLine.account_role },
          ),
        };
      }
      if (!account.is_postable) {
        return {
          ok: false,
          error: postingError(
            "ACCOUNT_NOT_POSTABLE",
            "Bound account is not postable.",
            { account_id: account.id, role: ruleLine.account_role },
          ),
        };
      }
    }

    const usesTransactionCurrency =
      ruleLine.currency_source === "event_transaction";
    const amountTransaction = usesTransactionCurrency
      ? sourceAmount
      : roundMoney(sourceAmount / event.exchange_rate);
    const amountBase = usesTransactionCurrency
      ? roundMoney(sourceAmount * event.exchange_rate)
      : sourceAmount;

    if (amountTransaction <= 0 || amountBase <= 0) {
      continue;
    }

    const isDebit = ruleLine.side === "debit";
    const taxCode =
      ruleLine.tax_behaviour === "pass_through" ? ruleLine.tax_code : null;

    lines.push({
      id: createId(),
      journal_entry_id: journalEntryId,
      line_no: outputLineNo,
      account_id: accountIdOrError,
      description: ruleLine.description,
      debit_transaction: isDebit ? amountTransaction : 0,
      credit_transaction: isDebit ? 0 : amountTransaction,
      debit_base: isDebit ? amountBase : 0,
      credit_base: isDebit ? 0 : amountBase,
      tax_code: taxCode,
    });

    outputLineNo += 1;
  }

  if (lines.length === 0) {
    return {
      ok: false,
      error: postingError(
        "NO_POSTING_LINES",
        "Posting rule produced no journal lines for the business event amounts.",
        { event_type: event.event_type, rule_id: rule.id },
      ),
    };
  }

  return { lines };
}

function buildLedgerEntries(input: {
  event: AccountingBusinessEvent;
  journalEntry: JournalEntry;
  journalLines: JournalLine[];
  fiscalPeriodId: string;
  createId: () => string;
  nowIso: string;
}): LedgerEntry[] {
  const {
    event,
    journalEntry,
    journalLines,
    fiscalPeriodId,
    createId,
    nowIso,
  } = input;

  return journalLines.map((line) => ({
    id: createId(),
    journal_entry_id: journalEntry.id,
    journal_line_id: line.id,
    fiscal_period_id: fiscalPeriodId,
    account_id: line.account_id,
    entry_date: journalEntry.entry_date,
    debit_base: line.debit_base,
    credit_base: line.credit_base,
    debit_transaction: line.debit_transaction,
    credit_transaction: line.credit_transaction,
    transaction_currency: event.transaction_currency,
    base_currency: event.base_currency,
    created_at: nowIso,
  }));
}

/**
 * Run the generic posting pipeline.
 * Does not persist journals, ledger rows, or mutate operational modules.
 */
export function runPostingPipeline(
  event: AccountingBusinessEvent,
  context: PostingContext,
): PostingPipelineResult {
  const eventError = validateBusinessEvent(event);
  if (eventError) {
    return { ok: false, error: eventError };
  }

  const contextError = validatePostingContext(context);
  if (contextError) {
    return { ok: false, error: contextError };
  }

  const periodError = validateFiscalPeriodForEvent(
    event,
    context.fiscalPeriod,
  );
  if (periodError) {
    return { ok: false, error: periodError };
  }

  const ruleOrError = resolveActivePostingRule(event, context.postingRules);
  if (!("lines" in ruleOrError)) {
    return { ok: false, error: ruleOrError };
  }
  const rule = ruleOrError;

  const createId = context.createId ?? defaultCreateId;
  const nowIso = context.nowIso ?? new Date().toISOString();
  const journalEntryId = createId();
  const entryDate = toDateOnly(event.occurred_at);

  const linesResult = buildProposedLines({
    event,
    rule,
    context,
    journalEntryId,
    createId,
  });
  if ("ok" in linesResult) {
    return linesResult;
  }

  const journalLines = linesResult.lines;
  const debitBaseTotal = roundMoney(
    journalLines.reduce((sum, line) => sum + line.debit_base, 0),
  );
  const creditBaseTotal = roundMoney(
    journalLines.reduce((sum, line) => sum + line.credit_base, 0),
  );

  const balanceError = validateBalancedBaseAmounts(
    debitBaseTotal,
    creditBaseTotal,
  );
  if (balanceError) {
    return { ok: false, error: balanceError };
  }

  const journalEntry: JournalEntry = {
    id: journalEntryId,
    business_event_id: event.id,
    transaction_id: event.transaction_id,
    fiscal_period_id: context.fiscalPeriod.id,
    entry_date: entryDate,
    memo: rule.description,
    // Proposal is validated as postable; persistence assigns posting_number.
    status: "posted",
    posting_number: null,
    transaction_currency: event.transaction_currency,
    base_currency: event.base_currency,
    exchange_rate: event.exchange_rate,
    reversal_of_journal_entry_id: null,
    posted_at: nowIso,
    created_at: nowIso,
  };

  const ledgerEntries = buildLedgerEntries({
    event,
    journalEntry,
    journalLines,
    fiscalPeriodId: context.fiscalPeriod.id,
    createId,
    nowIso,
  });

  const result: PostingResult = {
    event_id: event.id,
    rule_id: rule.id,
    rule_version: rule.version,
    rule_priority: rule.priority,
    journal_entry: journalEntry,
    journal_lines: journalLines,
    ledger_entries: ledgerEntries,
  };

  return { ok: true, data: result };
}
