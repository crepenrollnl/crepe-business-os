import { describe, expect, it } from "vitest";
import type {
  AccountRoleBinding,
  AccountingBusinessEvent,
  FiscalPeriod,
} from "@/types/accounting";
import type { PostingContext } from "../types/posting-engine";
import { postingEngineService } from "../services/posting-engine-service";
import { createWriteOffPostingRule } from "./write-off-posting-rule";

function period(): FiscalPeriod {
  return {
    id: "period-1",
    name: "2026-Q3",
    start_date: "2026-07-01",
    end_date: "2026-09-30",
    status: "open",
    closed_at: null,
    created_at: "2026-07-01T00:00:00.000Z",
  };
}

function event(amount: number): AccountingBusinessEvent {
  return {
    id: "event-write-off-1",
    event_type: "waste_recognized",
    transaction_id: null,
    source_module: "write_offs",
    source_document_type: "write_off",
    source_document_id: "wo-1",
    idempotency_key: "waste_recognized:wo-1",
    occurred_at: "2026-09-05T10:00:00.000Z",
    transaction_currency: "EUR",
    base_currency: "EUR",
    exchange_rate: 1,
    rate_date: "2026-09-05",
    amounts: {
      gross_amount: null,
      net_amount: null,
      tax_amount: null,
      cogs_amount: null,
      discount_amount: null,
      shipping_amount: null,
      other_amount: amount,
    },
    tax_lines: [],
    posting_status: "pending",
    journal_entry_id: null,
    failure_reason: null,
    created_at: "2026-09-05T10:00:00.000Z",
  };
}

function bindings(): AccountRoleBinding[] {
  return [
    {
      id: "bind-waste",
      role: "waste_expense",
      account_id: "acct-6150",
      effective_from: "2026-01-01",
      effective_to: null,
      is_active: true,
      created_at: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "bind-raw",
      role: "inventory_asset",
      account_id: "acct-1100",
      effective_from: "2026-01-01",
      effective_to: null,
      is_active: true,
      created_at: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "bind-fg",
      role: "finished_goods_inventory",
      account_id: "acct-1110",
      effective_from: "2026-01-01",
      effective_to: null,
      is_active: true,
      created_at: "2026-01-01T00:00:00.000Z",
    },
  ];
}

function context(itemType: "ingredient" | "finished_good"): PostingContext {
  let seq = 0;
  return {
    fiscalPeriod: period(),
    postingRules: [createWriteOffPostingRule(itemType)],
    accountRoleBindings: bindings(),
    nowIso: "2026-09-05T12:00:00.000Z",
    createId: () => {
      seq += 1;
      return `id-${seq}`;
    },
    accountsById: {
      "acct-6150": { id: "acct-6150", is_postable: true, is_active: true },
      "acct-1100": { id: "acct-1100", is_postable: true, is_active: true },
      "acct-1110": { id: "acct-1110", is_postable: true, is_active: true },
    },
  };
}

describe("createWriteOffPostingRule", () => {
  it("posts a balanced Dr waste_expense / Cr inventory_asset for ingredients", () => {
    const result = postingEngineService.postBusinessEvent(
      event(12.5),
      context("ingredient"),
    );

    expect(result.error).toBeNull();
    const debit = result.data?.journal_lines.find((line) => line.debit_base > 0);
    const credit = result.data?.journal_lines.find(
      (line) => line.credit_base > 0,
    );
    expect(debit?.account_id).toBe("acct-6150");
    expect(credit?.account_id).toBe("acct-1100");
    expect(debit?.debit_base).toBe(12.5);
    expect(credit?.credit_base).toBe(12.5);
  });

  it("posts a balanced Dr waste_expense / Cr finished_goods_inventory for finished goods", () => {
    const result = postingEngineService.postBusinessEvent(
      event(40),
      context("finished_good"),
    );

    expect(result.error).toBeNull();
    const debit = result.data?.journal_lines.find((line) => line.debit_base > 0);
    const credit = result.data?.journal_lines.find(
      (line) => line.credit_base > 0,
    );
    expect(debit?.account_id).toBe("acct-6150");
    expect(credit?.account_id).toBe("acct-1110");
    expect(debit?.debit_base).toBe(40);
    expect(credit?.credit_base).toBe(40);
  });
});
