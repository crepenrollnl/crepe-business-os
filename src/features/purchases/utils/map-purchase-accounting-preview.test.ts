/**
 * Accounting Preview mapping coverage (DEV-101).
 */

import { describe, expect, it } from "vitest";
import type { PurchaseJournalProposal } from "../types/purchase-accounting";
import type { PurchaseTaxResult } from "../types/purchase-tax";
import type { PurchaseWithRelations } from "../types/purchase";
import {
  mapPurchaseJournalProposalToPreview,
  mapPurchaseTotalsToAccountingPreview,
} from "./map-purchase-accounting-preview";

function purchase(): PurchaseWithRelations {
  return {
    id: "purchase-1",
    supplier_id: "supplier-1",
    status: "received",
    invoice_number: "INV-1",
    notes: null,
    subtotal: 100,
    tax_total: 21,
    total: 121,
    currency: "EUR",
    purchased_at: "2026-07-26T09:00:00.000Z",
    transaction_id: "txn-1",
    production_plan_id: null,
    created_at: "2026-07-26T09:00:00.000Z",
    supplier: { id: "supplier-1", name: "Dairy Co" },
    items: [],
  };
}

function tax(): PurchaseTaxResult {
  return {
    document_id: "purchase-1",
    mode: "calculate",
    is_valid: true,
    subtotal: 100,
    tax_total: 21,
    grand_total: 121,
    effective_tax_rate: 0.21,
    lines: [],
    warnings: [],
    tax_result: {
      request_id: "req-1",
      mode: "calculate",
      country: "NL",
      currency: "EUR",
      jurisdiction_id: "jur-nl",
      document_type: "purchase",
      transaction_date: "2026-07-26",
      net_total: 100,
      tax_total: 21,
      gross_total: 121,
      effective_tax_rate: 0.21,
      breakdown: { lines: [], by_tax_code: {} },
      lines: [],
      applied_tax_definitions: [],
      rounding: { mode: "half_up", decimal_places: 2 },
      warnings: [],
      is_valid: true,
    },
  };
}

function proposal(): PurchaseJournalProposal {
  return {
    purchase: purchase(),
    business_event_id: "evt-1",
    tax: tax(),
    journalProposal: {
      event_id: "evt-1",
      rule_id: "posting-rule-purchase-received-v1",
      rule_version: 2,
      rule_priority: 100,
      journal_entry: {
        id: "je-1",
        business_event_id: "evt-1",
        transaction_id: "txn-1",
        fiscal_period_id: "period-1",
        entry_date: "2026-07-26",
        memo: null,
        status: "posted",
        posting_number: null,
        transaction_currency: "EUR",
        base_currency: "EUR",
        exchange_rate: 1,
        reversal_of_journal_entry_id: null,
        posted_at: null,
        created_at: "2026-07-26T12:00:00.000Z",
      },
      journal_lines: [
        {
          id: "jl-1",
          journal_entry_id: "je-1",
          line_no: 1,
          account_id: "acct-inventory",
          description: "Inventory",
          debit_transaction: 100,
          credit_transaction: 0,
          debit_base: 100,
          credit_base: 0,
          tax_code: null,
        },
        {
          id: "jl-2",
          journal_entry_id: "je-1",
          line_no: 2,
          account_id: "acct-vat",
          description: "Recoverable tax",
          debit_transaction: 21,
          credit_transaction: 0,
          debit_base: 21,
          credit_base: 0,
          tax_code: null,
        },
        {
          id: "jl-3",
          journal_entry_id: "je-1",
          line_no: 3,
          account_id: "acct-ap",
          description: "Accounts Payable",
          debit_transaction: 0,
          credit_transaction: 121,
          debit_base: 0,
          credit_base: 121,
          tax_code: null,
        },
      ],
      ledger_entries: [],
    },
  };
}

describe("mapPurchaseAccountingPreview (DEV-101)", () => {
  it("maps document totals without a journal proposal", () => {
    const preview = mapPurchaseTotalsToAccountingPreview(purchase());

    expect(preview).toEqual({
      net_amount: 100,
      tax_total: 21,
      grand_total: 121,
      currency: "EUR",
      status: "draft_proposal",
      has_proposal: false,
      lines: [],
    });
  });

  it("maps an existing journal proposal into display lines", () => {
    const preview = mapPurchaseJournalProposalToPreview(proposal());

    expect(preview.has_proposal).toBe(true);
    expect(preview.net_amount).toBe(100);
    expect(preview.tax_total).toBe(21);
    expect(preview.grand_total).toBe(121);
    expect(preview.lines).toEqual([
      {
        account_role: "inventory_asset",
        debit: 100,
        credit: 0,
        currency: "EUR",
      },
      {
        account_role: "vat_input",
        debit: 21,
        credit: 0,
        currency: "EUR",
      },
      {
        account_role: "accounts_payable",
        debit: 0,
        credit: 121,
        currency: "EUR",
      },
    ]);
  });
});
