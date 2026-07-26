/**
 * Generic Posting Engine validation (DEV-088).
 *
 * Validates envelopes and context only — no operational domain rules.
 */

import type {
  AccountRoleBinding,
  AccountingBusinessEvent,
  AccountingEventAmounts,
  FiscalPeriod,
  PostingRule,
} from "@/types/accounting";
import type { PostingContext, PostingError } from "../types/posting-engine";
import { postingError } from "./posting-errors";

const AMOUNT_FIELDS: readonly (keyof AccountingEventAmounts)[] = [
  "gross_amount",
  "net_amount",
  "tax_amount",
  "cogs_amount",
  "discount_amount",
  "shipping_amount",
  "other_amount",
] as const;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function toDateOnly(isoOrDate: string): string {
  return isoOrDate.slice(0, 10);
}

export function validateBusinessEvent(
  event: AccountingBusinessEvent,
): PostingError | null {
  if (!isNonEmptyString(event.id)) {
    return postingError("INVALID_EVENT", "Business event id is required.");
  }

  if (!isNonEmptyString(event.event_type)) {
    return postingError("INVALID_EVENT", "Business event type is required.");
  }

  if (!isNonEmptyString(event.idempotency_key)) {
    return postingError(
      "INVALID_EVENT",
      "Business event idempotency key is required.",
    );
  }

  if (!isNonEmptyString(event.occurred_at)) {
    return postingError(
      "INVALID_EVENT",
      "Business event occurred_at is required.",
    );
  }

  if (!isNonEmptyString(event.transaction_currency)) {
    return postingError(
      "INVALID_EVENT",
      "Business event transaction_currency is required.",
    );
  }

  if (!isNonEmptyString(event.base_currency)) {
    return postingError(
      "INVALID_EVENT",
      "Business event base_currency is required.",
    );
  }

  if (!isFiniteNumber(event.exchange_rate) || event.exchange_rate <= 0) {
    return postingError(
      "INVALID_EXCHANGE_RATE",
      "Business event exchange_rate must be a finite number greater than zero.",
      { exchange_rate: event.exchange_rate },
    );
  }

  if (event.amounts === null || typeof event.amounts !== "object") {
    return postingError(
      "INVALID_EVENT",
      "Business event amounts payload is required.",
    );
  }

  for (const field of AMOUNT_FIELDS) {
    const value = event.amounts[field];
    if (value !== null && (!isFiniteNumber(value) || value < 0)) {
      return postingError(
        "INVALID_EVENT",
        `Business event amount '${field}' must be null or a non-negative finite number.`,
        { field, value },
      );
    }
  }

  if (
    event.posting_status === "posted" ||
    event.journal_entry_id !== null
  ) {
    return postingError(
      "ALREADY_POSTED",
      "Business event is already posted.",
      {
        posting_status: event.posting_status,
        journal_entry_id: event.journal_entry_id,
      },
    );
  }

  return null;
}

export function validatePostingContext(
  context: PostingContext,
): PostingError | null {
  if (!context.fiscalPeriod) {
    return postingError(
      "INVALID_CONTEXT",
      "Posting context fiscal period is required.",
    );
  }

  if (!Array.isArray(context.postingRules)) {
    return postingError(
      "INVALID_CONTEXT",
      "Posting context postingRules must be an array.",
    );
  }

  if (!Array.isArray(context.accountRoleBindings)) {
    return postingError(
      "INVALID_CONTEXT",
      "Posting context accountRoleBindings must be an array.",
    );
  }

  return null;
}

export function validateFiscalPeriodForEvent(
  event: AccountingBusinessEvent,
  period: FiscalPeriod,
): PostingError | null {
  if (period.status !== "open") {
    return postingError(
      "PERIOD_NOT_OPEN",
      "Fiscal period is not open for posting.",
      { fiscal_period_id: period.id, status: period.status },
    );
  }

  const eventDate = toDateOnly(event.occurred_at);
  if (eventDate < period.start_date || eventDate > period.end_date) {
    return postingError(
      "EVENT_DATE_OUTSIDE_PERIOD",
      "Business event date is outside the fiscal period range.",
      {
        event_date: eventDate,
        period_start: period.start_date,
        period_end: period.end_date,
      },
    );
  }

  return null;
}

export function resolveActivePostingRule(
  event: AccountingBusinessEvent,
  rules: readonly PostingRule[],
): PostingRule | PostingError {
  const eventDate = toDateOnly(event.occurred_at);

  const matches = rules.filter((rule) => {
    if (!rule.is_active) {
      return false;
    }
    if (rule.event_type !== event.event_type) {
      return false;
    }
    if (rule.effective_from > eventDate) {
      return false;
    }
    if (rule.effective_to !== null && rule.effective_to < eventDate) {
      return false;
    }
    return Array.isArray(rule.lines) && rule.lines.length > 0;
  });

  if (matches.length === 0) {
    return postingError(
      "RULE_NOT_FOUND",
      "No active posting rule matches the business event.",
      { event_type: event.event_type, event_date: eventDate },
    );
  }

  matches.sort((a, b) => {
    if (b.version !== a.version) {
      return b.version - a.version;
    }
    return b.effective_from.localeCompare(a.effective_from);
  });

  return matches[0];
}

export function resolveAccountIdForRole(
  role: AccountRoleBinding["role"],
  eventDate: string,
  bindings: readonly AccountRoleBinding[],
): string | PostingError {
  const matches = bindings.filter((binding) => {
    if (!binding.is_active) {
      return false;
    }
    if (binding.role !== role) {
      return false;
    }
    if (binding.effective_from > eventDate) {
      return false;
    }
    if (binding.effective_to !== null && binding.effective_to < eventDate) {
      return false;
    }
    return isNonEmptyString(binding.account_id);
  });

  if (matches.length === 0) {
    return postingError(
      "ACCOUNT_ROLE_UNBOUND",
      `No active account binding for role '${role}'.`,
      { role, event_date: eventDate },
    );
  }

  matches.sort((a, b) => b.effective_from.localeCompare(a.effective_from));
  return matches[0].account_id;
}

export function validateBalancedBaseAmounts(
  debitBaseTotal: number,
  creditBaseTotal: number,
): PostingError | null {
  if (debitBaseTotal !== creditBaseTotal) {
    return postingError(
      "UNBALANCED_JOURNAL",
      "Journal entry is not balanced in base currency.",
      {
        debit_base_total: debitBaseTotal,
        credit_base_total: creditBaseTotal,
      },
    );
  }

  if (debitBaseTotal <= 0) {
    return postingError(
      "NO_POSTING_LINES",
      "Journal entry has no non-zero base amounts to post.",
    );
  }

  return null;
}
