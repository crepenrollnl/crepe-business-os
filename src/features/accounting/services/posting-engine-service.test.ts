/**
 * Generic Posting Engine coverage (DEV-088).
 *
 * Verifies rule-driven posting only — no Purchases/Sales/Production/Inventory rules.
 */

import { describe, expect, it } from "vitest";
import type {
  AccountRoleBinding,
  AccountingBusinessEvent,
  FiscalPeriod,
  PostingRule,
} from "@/types/accounting";
import type { PostingContext } from "../types/posting-engine";
import { postingEngineService } from "./posting-engine-service";

function period(overrides?: Partial<FiscalPeriod>): FiscalPeriod {
  return {
    id: "period-1",
    name: "2026-Q3",
    start_date: "2026-07-01",
    end_date: "2026-09-30",
    status: "open",
    closed_at: null,
    created_at: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

function event(
  overrides?: Partial<AccountingBusinessEvent>,
): AccountingBusinessEvent {
  return {
    id: "event-1",
    event_type: "expense_recognized",
    transaction_id: "txn-1",
    source_module: "accounting_test",
    source_document_type: "fixture",
    source_document_id: "doc-1",
    idempotency_key: "expense_recognized:doc-1",
    occurred_at: "2026-07-26T10:00:00.000Z",
    transaction_currency: "EUR",
    base_currency: "EUR",
    exchange_rate: 1,
    rate_date: "2026-07-26",
    amounts: {
      gross_amount: null,
      net_amount: 100,
      tax_amount: null,
      cogs_amount: null,
      discount_amount: null,
      shipping_amount: null,
      other_amount: 100,
    },
    tax_lines: [],
    posting_status: "pending",
    journal_entry_id: null,
    failure_reason: null,
    created_at: "2026-07-26T10:00:00.000Z",
    ...overrides,
  };
}

function balancedExpenseRule(overrides?: Partial<PostingRule>): PostingRule {
  return {
    id: "rule-1",
    event_type: "expense_recognized",
    version: 1,
    effective_from: "2026-01-01",
    effective_to: null,
    is_active: true,
    created_at: "2026-01-01T00:00:00.000Z",
    lines: [
      {
        id: "rule-line-1",
        posting_rule_id: "rule-1",
        line_no: 1,
        account_role: "other",
        side: "debit",
        amount_field: "net_amount",
        tax_code: null,
      },
      {
        id: "rule-line-2",
        posting_rule_id: "rule-1",
        line_no: 2,
        account_role: "bank",
        side: "credit",
        amount_field: "other_amount",
        tax_code: null,
      },
    ],
    ...overrides,
  };
}

function bindings(): AccountRoleBinding[] {
  return [
    {
      id: "bind-other",
      role: "other",
      account_id: "acct-expense",
      effective_from: "2026-01-01",
      effective_to: null,
      is_active: true,
      created_at: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "bind-bank",
      role: "bank",
      account_id: "acct-bank",
      effective_from: "2026-01-01",
      effective_to: null,
      is_active: true,
      created_at: "2026-01-01T00:00:00.000Z",
    },
  ];
}

function context(overrides?: Partial<PostingContext>): PostingContext {
  let seq = 0;
  return {
    fiscalPeriod: period(),
    postingRules: [balancedExpenseRule()],
    accountRoleBindings: bindings(),
    nowIso: "2026-07-26T12:00:00.000Z",
    createId: () => {
      seq += 1;
      return `id-${seq}`;
    },
    accountsById: {
      "acct-expense": {
        id: "acct-expense",
        is_postable: true,
        is_active: true,
      },
      "acct-bank": {
        id: "acct-bank",
        is_postable: true,
        is_active: true,
      },
    },
    ...overrides,
  };
}

describe("postingEngineService (DEV-088 generic foundation)", () => {
  it("posts a balanced journal from configurable rules", () => {
    const result = postingEngineService.postBusinessEvent(
      event(),
      context(),
    );

    expect(result.error).toBeNull();
    expect(result.data?.journal_entry.status).toBe("posted");
    expect(result.data?.journal_entry.business_event_id).toBe("event-1");
    expect(result.data?.journal_lines).toHaveLength(2);
    expect(result.data?.ledger_entries).toHaveLength(2);

    const debit = result.data?.journal_lines.find((line) => line.debit_base > 0);
    const credit = result.data?.journal_lines.find(
      (line) => line.credit_base > 0,
    );
    expect(debit?.account_id).toBe("acct-expense");
    expect(credit?.account_id).toBe("acct-bank");
    expect(debit?.debit_base).toBe(100);
    expect(credit?.credit_base).toBe(100);
  });

  it("converts transaction amounts to base currency using exchange_rate", () => {
    const result = postingEngineService.runPipeline(
      event({
        transaction_currency: "USD",
        base_currency: "EUR",
        exchange_rate: 0.5,
        amounts: {
          gross_amount: null,
          net_amount: 100,
          tax_amount: null,
          cogs_amount: null,
          discount_amount: null,
          shipping_amount: null,
          other_amount: 100,
        },
      }),
      context(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.data.journal_lines[0]?.debit_transaction).toBe(100);
    expect(result.data.journal_lines[0]?.debit_base).toBe(50);
    expect(result.data.journal_lines[1]?.credit_transaction).toBe(100);
    expect(result.data.journal_lines[1]?.credit_base).toBe(50);
  });

  it("returns RULE_NOT_FOUND when no active rule matches", () => {
    const result = postingEngineService.runPipeline(
      event({ event_type: "fx_revaluation" }),
      context(),
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe("RULE_NOT_FOUND");
  });

  it("returns PERIOD_NOT_OPEN when fiscal period is locked", () => {
    const result = postingEngineService.runPipeline(
      event(),
      context({
        fiscalPeriod: period({ status: "locked" }),
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe("PERIOD_NOT_OPEN");
  });

  it("returns EVENT_DATE_OUTSIDE_PERIOD when event is outside period", () => {
    const result = postingEngineService.runPipeline(
      event({ occurred_at: "2026-01-15T10:00:00.000Z" }),
      context(),
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe("EVENT_DATE_OUTSIDE_PERIOD");
  });

  it("returns ACCOUNT_ROLE_UNBOUND when a role has no binding", () => {
    const result = postingEngineService.runPipeline(
      event(),
      context({
        accountRoleBindings: bindings().filter((row) => row.role !== "bank"),
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe("ACCOUNT_ROLE_UNBOUND");
  });

  it("returns UNBALANCED_JOURNAL when rule amounts do not balance", () => {
    const result = postingEngineService.runPipeline(
      event({
        amounts: {
          gross_amount: null,
          net_amount: 100,
          tax_amount: null,
          cogs_amount: null,
          discount_amount: null,
          shipping_amount: null,
          other_amount: 40,
        },
      }),
      context(),
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe("UNBALANCED_JOURNAL");
  });

  it("returns NO_POSTING_LINES when all amount fields are null or zero", () => {
    const result = postingEngineService.runPipeline(
      event({
        amounts: {
          gross_amount: null,
          net_amount: null,
          tax_amount: null,
          cogs_amount: null,
          discount_amount: null,
          shipping_amount: null,
          other_amount: 0,
        },
      }),
      context(),
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe("NO_POSTING_LINES");
  });

  it("returns ALREADY_POSTED for previously posted events", () => {
    const result = postingEngineService.runPipeline(
      event({
        posting_status: "posted",
        journal_entry_id: "journal-existing",
      }),
      context(),
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe("ALREADY_POSTED");
  });

  it("selects the highest active rule version", () => {
    const result = postingEngineService.runPipeline(
      event(),
      context({
        postingRules: [
          balancedExpenseRule({ id: "rule-v1", version: 1 }),
          balancedExpenseRule({
            id: "rule-v2",
            version: 2,
            lines: [
              {
                id: "v2-1",
                posting_rule_id: "rule-v2",
                line_no: 1,
                account_role: "other",
                side: "debit",
                amount_field: "net_amount",
                tax_code: "VAT-TEST",
              },
              {
                id: "v2-2",
                posting_rule_id: "rule-v2",
                line_no: 2,
                account_role: "bank",
                side: "credit",
                amount_field: "other_amount",
                tax_code: null,
              },
            ],
          }),
        ],
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.data.rule_id).toBe("rule-v2");
    expect(result.data.rule_version).toBe(2);
    expect(result.data.journal_lines[0]?.tax_code).toBe("VAT-TEST");
  });

  it("rejects inactive or non-postable accounts when provided in context", () => {
    const result = postingEngineService.runPipeline(
      event(),
      context({
        accountsById: {
          "acct-expense": {
            id: "acct-expense",
            is_postable: false,
            is_active: true,
          },
          "acct-bank": {
            id: "acct-bank",
            is_postable: true,
            is_active: true,
          },
        },
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe("ACCOUNT_NOT_POSTABLE");
  });

  it("maps structured pipeline failures to ServiceResult error strings", () => {
    const result = postingEngineService.postBusinessEvent(
      event({ event_type: "payment_received" }),
      context(),
    );

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "No active posting rule matches the business event.",
    );
  });
});
