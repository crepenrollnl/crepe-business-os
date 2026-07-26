/**
 * Purchases → Accounting integration coverage (DEV-090 / DEV-092).
 *
 * Purchase Confirmed (received) → generic Operational Accounting Integration
 * → Journal Proposal. No ledger persistence from Purchases.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AccountRoleBinding,
  FiscalPeriod,
  PostingRule,
} from "@/types/accounting";
import type { PurchaseAccountingContext } from "../types/purchase-accounting";
import type { PurchaseWithRelations } from "../types/purchase";

const { proposeSpy, supabaseMock } = vi.hoisted(() => ({
  proposeSpy: vi.fn(),
  supabaseMock: {
    from: vi.fn(),
    rpc: vi.fn(),
    auth: { getUser: vi.fn() },
  },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: supabaseMock,
}));

vi.mock(
  "@/features/accounting/services/operational-accounting-integration-service",
  async () => {
    const actual = await vi.importActual<
      typeof import("@/features/accounting/services/operational-accounting-integration-service")
    >(
      "@/features/accounting/services/operational-accounting-integration-service",
    );
    return {
      operationalAccountingIntegrationService: {
        ...actual.operationalAccountingIntegrationService,
        propose: (
          ...args: Parameters<
            typeof actual.operationalAccountingIntegrationService.propose
          >
        ) => {
          proposeSpy(...args);
          return actual.operationalAccountingIntegrationService.propose(
            ...args,
          );
        },
      },
    };
  },
);

import { purchaseAccountingService } from "./purchase-accounting-service";
import { createPurchaseReceivedPostingRule } from "./purchase-received-posting-rule";

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

function purchase(
  overrides?: Partial<PurchaseWithRelations>,
): PurchaseWithRelations {
  return {
    id: "purchase-1",
    supplier_id: "supplier-1",
    status: "received",
    invoice_number: "INV-100",
    notes: null,
    subtotal: 200,
    tax_total: 40,
    total: 240,
    currency: "EUR",
    purchased_at: "2026-07-26T09:00:00.000Z",
    transaction_id: "txn-1",
    production_plan_id: null,
    created_at: "2026-07-26T09:00:00.000Z",
    supplier: { id: "supplier-1", name: "Dairy Co" },
    items: [
      {
        id: "item-1",
        purchase_id: "purchase-1",
        ingredient_id: "ing-1",
        quantity: 10,
        unit_cost: 20,
        line_total: 200,
        ingredient: { id: "ing-1", name: "Milk", unit: "L" },
      },
    ],
    ...overrides,
  };
}

function bindings(): AccountRoleBinding[] {
  return [
    {
      id: "bind-inventory",
      role: "inventory_asset",
      account_id: "acct-inventory",
      effective_from: "2020-01-01",
      effective_to: null,
      is_active: true,
      created_at: "2020-01-01T00:00:00.000Z",
    },
    {
      id: "bind-ap",
      role: "accounts_payable",
      account_id: "acct-ap",
      effective_from: "2020-01-01",
      effective_to: null,
      is_active: true,
      created_at: "2020-01-01T00:00:00.000Z",
    },
  ];
}

function accounting(
  overrides?: Partial<PurchaseAccountingContext>,
): PurchaseAccountingContext {
  let seq = 0;
  return {
    fiscalPeriod: period(),
    accountRoleBindings: bindings(),
    baseCurrency: "EUR",
    exchangeRate: 1,
    rateDate: "2026-07-26",
    nowIso: "2026-07-26T12:00:00.000Z",
    createId: () => {
      seq += 1;
      return `id-${seq}`;
    },
    accountsById: {
      "acct-inventory": {
        id: "acct-inventory",
        is_postable: true,
        is_active: true,
      },
      "acct-ap": {
        id: "acct-ap",
        is_postable: true,
        is_active: true,
      },
    },
    ...overrides,
  };
}

describe("purchaseAccountingService (DEV-090 / DEV-092)", () => {
  beforeEach(() => {
    proposeSpy.mockClear();
  });

  it("routes Purchases through the generic Accounting integration framework", () => {
    const result = purchaseAccountingService.proposeJournalForPurchaseReceived(
      purchase(),
      accounting(),
    );

    expect(result.error).toBeNull();
    expect(proposeSpy).toHaveBeenCalledTimes(1);
    expect(proposeSpy.mock.calls[0]?.[0]).toMatchObject({
      mode: "propose",
      event: {
        event_type: "purchase_received",
        source_module: "purchases",
        source_document_id: "purchase-1",
      },
      metadata: {
        source_module: "purchases",
        source_document_type: "purchase",
        source_document_id: "purchase-1",
        idempotency_key: "purchase_received:purchase-1",
      },
    });
  });

  it("emits purchase_received and proposes Dr Inventory / Cr Accounts Payable", () => {
    const result = purchaseAccountingService.proposeJournalForPurchaseReceived(
      purchase(),
      accounting(),
    );

    expect(result.error).toBeNull();
    expect(result.data?.journalProposal.journal_entry.status).toBe("posted");
    expect(result.data?.journalProposal.journal_lines).toHaveLength(2);

    const debit = result.data?.journalProposal.journal_lines.find(
      (line) => line.debit_base > 0,
    );
    const credit = result.data?.journalProposal.journal_lines.find(
      (line) => line.credit_base > 0,
    );

    expect(debit?.account_id).toBe("acct-inventory");
    expect(credit?.account_id).toBe("acct-ap");
    expect(debit?.debit_base).toBe(200);
    expect(credit?.credit_base).toBe(200);
    expect(result.data?.journalProposal.ledger_entries).toHaveLength(2);
  });

  it("rejects draft purchases that are not confirmed", () => {
    const eventResult =
      purchaseAccountingService.buildPurchaseReceivedBusinessEvent(
        purchase({ status: "draft" }),
        accounting(),
      );

    expect(eventResult.data).toBeNull();
    expect(eventResult.error).toMatch(/confirmed \(received\)/i);
  });

  it("fails when the posting rule is inactive / invalid for the event", () => {
    const inactiveRule: PostingRule = createPurchaseReceivedPostingRule({
      is_active: false,
    });

    const result = purchaseAccountingService.proposeJournalForPurchaseReceived(
      purchase(),
      accounting({ postingRules: [inactiveRule] }),
    );

    expect(result.data).toBeNull();
    expect(result.error).toMatch(/no active posting rule/i);
  });

  it("fails when an account role binding is missing", () => {
    const result = purchaseAccountingService.proposeJournalForPurchaseReceived(
      purchase(),
      accounting({
        accountRoleBindings: bindings().filter(
          (row) => row.role !== "accounts_payable",
        ),
      }),
    );

    expect(result.data).toBeNull();
    expect(result.error).toMatch(/no active account binding/i);
  });

  it("detects imbalance when a custom rule uses unequal amount fields", () => {
    const imbalancedRule = createPurchaseReceivedPostingRule({
      id: "imbalanced-purchase-rule",
      lines: [
        {
          id: "d1",
          posting_rule_id: "imbalanced-purchase-rule",
          line_no: 1,
          account_role: "inventory_asset",
          side: "debit",
          amount_field: "gross_amount",
          currency_source: "event_transaction",
          tax_behaviour: "none",
          tax_code: null,
          description: "Inventory",
        },
        {
          id: "c1",
          posting_rule_id: "imbalanced-purchase-rule",
          line_no: 2,
          account_role: "accounts_payable",
          side: "credit",
          amount_field: "net_amount",
          currency_source: "event_transaction",
          tax_behaviour: "none",
          tax_code: null,
          description: "AP",
        },
      ],
    });

    const result = purchaseAccountingService.proposeJournalForPurchaseReceived(
      purchase(),
      accounting({ postingRules: [imbalancedRule] }),
    );

    expect(result.data).toBeNull();
    expect(result.error).toMatch(/not balanced/i);
  });

  it("supports foreign currency purchases via exchange_rate", () => {
    const result = purchaseAccountingService.proposeJournalForPurchaseReceived(
      purchase({
        currency: "USD",
        subtotal: 100,
        tax_total: 0,
        total: 100,
      }),
      accounting({
        baseCurrency: "EUR",
        exchangeRate: 0.9,
      }),
    );

    expect(result.error).toBeNull();
    const lines = result.data?.journalProposal.journal_lines ?? [];
    expect(lines[0]?.debit_transaction).toBe(100);
    expect(lines[0]?.debit_base).toBe(90);
    expect(lines[1]?.credit_transaction).toBe(100);
    expect(lines[1]?.credit_base).toBe(90);
    expect(result.data?.journalProposal.journal_entry.transaction_currency).toBe(
      "USD",
    );
    expect(result.data?.journalProposal.journal_entry.base_currency).toBe("EUR");
  });

  it("fails when the fiscal period is closed", () => {
    const result = purchaseAccountingService.proposeJournalForPurchaseReceived(
      purchase(),
      accounting({
        fiscalPeriod: period({
          status: "closed",
          closed_at: "2026-07-31T00:00:00.000Z",
        }),
      }),
    );

    expect(result.data).toBeNull();
    expect(result.error).toMatch(/not open for posting/i);
  });

  it("builds a purchase_received event with purchases source metadata", () => {
    const eventResult =
      purchaseAccountingService.buildPurchaseReceivedBusinessEvent(
        purchase(),
        accounting(),
      );

    expect(eventResult.error).toBeNull();
    expect(eventResult.data?.event_type).toBe("purchase_received");
    expect(eventResult.data?.source_module).toBe("purchases");
    expect(eventResult.data?.source_document_type).toBe("purchase");
    expect(eventResult.data?.source_document_id).toBe("purchase-1");
    expect(eventResult.data?.idempotency_key).toBe(
      "purchase_received:purchase-1",
    );
    expect(eventResult.data?.amounts.net_amount).toBe(200);
    expect(eventResult.data?.amounts.tax_amount).toBe(40);
    expect(eventResult.data?.amounts.gross_amount).toBe(240);
  });
});
