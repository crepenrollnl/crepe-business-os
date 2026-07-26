/**
 * Sales → Accounting integration coverage (DEV-093).
 *
 * Sale Completed → sale_completed + cogs_recognized
 * → generic Operational Accounting Integration → two journal proposals.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AccountRoleBinding,
  FiscalPeriod,
  PostingRule,
} from "@/types/accounting";
import type { SaleAccountingContext } from "../types/sale-accounting";
import type { SaleWithLines } from "../types/sale";
import {
  createCogsRecognizedPostingRule,
  createSaleCompletedRevenuePostingRule,
} from "./sale-completed-posting-rule";

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

import { saleAccountingService } from "./sale-accounting-service";

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

function sale(overrides?: Partial<SaleWithLines>): SaleWithLines {
  return {
    id: "sale-1",
    sale_number: "S-1001",
    customer_id: "customer-1",
    status: "confirmed",
    sale_date: "2026-07-26",
    confirmed_at: "2026-07-26T11:00:00.000Z",
    paid_at: null,
    cancelled_at: null,
    subtotal: 100,
    tax_total: 21,
    total: 121,
    notes: null,
    created_at: "2026-07-26T10:00:00.000Z",
    lines: [
      {
        id: "line-1",
        sale_id: "sale-1",
        product_id: "product-1",
        quantity: 4,
        unit_price: 25,
        line_total: 100,
        created_at: "2026-07-26T10:00:00.000Z",
      },
    ],
    ...overrides,
  };
}

function bindings(): AccountRoleBinding[] {
  return [
    {
      id: "bind-ar",
      role: "accounts_receivable",
      account_id: "acct-ar",
      effective_from: "2020-01-01",
      effective_to: null,
      is_active: true,
      created_at: "2020-01-01T00:00:00.000Z",
    },
    {
      id: "bind-cash",
      role: "cash",
      account_id: "acct-cash",
      effective_from: "2020-01-01",
      effective_to: null,
      is_active: true,
      created_at: "2020-01-01T00:00:00.000Z",
    },
    {
      id: "bind-revenue",
      role: "revenue",
      account_id: "acct-revenue",
      effective_from: "2020-01-01",
      effective_to: null,
      is_active: true,
      created_at: "2020-01-01T00:00:00.000Z",
    },
    {
      id: "bind-cogs",
      role: "cogs",
      account_id: "acct-cogs",
      effective_from: "2020-01-01",
      effective_to: null,
      is_active: true,
      created_at: "2020-01-01T00:00:00.000Z",
    },
    {
      id: "bind-inventory",
      role: "inventory_asset",
      account_id: "acct-inventory",
      effective_from: "2020-01-01",
      effective_to: null,
      is_active: true,
      created_at: "2020-01-01T00:00:00.000Z",
    },
  ];
}

function accounting(
  overrides?: Partial<SaleAccountingContext>,
): SaleAccountingContext {
  let seq = 0;
  return {
    fiscalPeriod: period(),
    accountRoleBindings: bindings(),
    baseCurrency: "EUR",
    transactionCurrency: "EUR",
    exchangeRate: 1,
    rateDate: "2026-07-26",
    nowIso: "2026-07-26T12:00:00.000Z",
    createId: () => {
      seq += 1;
      return `id-${seq}`;
    },
    accountsById: {
      "acct-ar": { id: "acct-ar", is_postable: true, is_active: true },
      "acct-cash": { id: "acct-cash", is_postable: true, is_active: true },
      "acct-revenue": {
        id: "acct-revenue",
        is_postable: true,
        is_active: true,
      },
      "acct-cogs": { id: "acct-cogs", is_postable: true, is_active: true },
      "acct-inventory": {
        id: "acct-inventory",
        is_postable: true,
        is_active: true,
      },
    },
    ...overrides,
  };
}

function source(
  saleOverrides?: Partial<SaleWithLines>,
  totalCogs = 40,
) {
  return {
    sale: sale(saleOverrides),
    total_cogs: totalCogs,
  };
}

describe("saleAccountingService (DEV-093)", () => {
  beforeEach(() => {
    proposeSpy.mockClear();
  });

  it("posts revenue: Dr Accounts Receivable / Cr Sales Revenue", () => {
    const result = saleAccountingService.proposeJournalsForSaleCompleted(
      source(),
      accounting(),
    );

    expect(result.error).toBeNull();
    expect(result.data?.revenue).not.toBeNull();

    const lines = result.data?.revenue?.journal_proposal.journal_lines ?? [];
    const debit = lines.find((line) => line.debit_base > 0);
    const credit = lines.find((line) => line.credit_base > 0);

    expect(debit?.account_id).toBe("acct-ar");
    expect(credit?.account_id).toBe("acct-revenue");
    expect(debit?.debit_base).toBe(100);
    expect(credit?.credit_base).toBe(100);
  });

  it("posts COGS: Dr Cost of Goods Sold / Cr Inventory Asset", () => {
    const result = saleAccountingService.proposeJournalsForSaleCompleted(
      source(),
      accounting(),
    );

    expect(result.error).toBeNull();
    expect(result.data?.cogs).not.toBeNull();

    const lines = result.data?.cogs?.journal_proposal.journal_lines ?? [];
    const debit = lines.find((line) => line.debit_base > 0);
    const credit = lines.find((line) => line.credit_base > 0);

    expect(debit?.account_id).toBe("acct-cogs");
    expect(credit?.account_id).toBe("acct-inventory");
    expect(debit?.debit_base).toBe(40);
    expect(credit?.credit_base).toBe(40);
  });

  it("returns combined revenue + COGS posting results", () => {
    const result = saleAccountingService.proposeJournalsForSaleCompleted(
      source(),
      accounting(),
    );

    expect(result.error).toBeNull();
    expect(result.data?.revenue?.event_type).toBe("sale_completed");
    expect(result.data?.cogs?.event_type).toBe("cogs_recognized");
    expect(result.data?.revenue?.mode).toBe("propose");
    expect(result.data?.cogs?.mode).toBe("propose");
    expect(result.data?.revenue?.posted_journal).toBeNull();
    expect(result.data?.cogs?.posted_journal).toBeNull();
    expect(result.data?.total_cogs).toBe(40);
  });

  it("reuses the generic Accounting integration framework twice", () => {
    const result = saleAccountingService.proposeJournalsForSaleCompleted(
      source(),
      accounting(),
    );

    expect(result.error).toBeNull();
    expect(proposeSpy).toHaveBeenCalledTimes(2);
    expect(proposeSpy.mock.calls[0]?.[0]).toMatchObject({
      mode: "propose",
      event: { event_type: "sale_completed", source_module: "sales" },
      metadata: {
        idempotency_key: "sale_completed:sale-1",
        source_document_id: "sale-1",
      },
    });
    expect(proposeSpy.mock.calls[1]?.[0]).toMatchObject({
      mode: "propose",
      event: { event_type: "cogs_recognized", source_module: "sales" },
      metadata: {
        idempotency_key: "cogs_recognized:sale-1",
        source_document_id: "sale-1",
      },
    });
  });

  it("propagates posting results with metadata echo", () => {
    const result = saleAccountingService.proposeJournalsForSaleCompleted(
      source(),
      accounting(),
    );

    expect(result.error).toBeNull();
    expect(result.data?.revenue?.metadata.source_module).toBe("sales");
    expect(result.data?.revenue?.metadata.tags).toMatchObject({
      journal: "revenue",
    });
    expect(result.data?.cogs?.metadata.tags).toMatchObject({
      journal: "cogs",
    });
    expect(result.data?.revenue?.business_event_id).toBe(
      result.data?.revenue?.journal_proposal.event_id,
    );
  });

  it("supports cash settlement debit via revenueDebitRole", () => {
    const result = saleAccountingService.proposeJournalsForSaleCompleted(
      source(),
      accounting({ revenueDebitRole: "cash" }),
    );

    expect(result.error).toBeNull();
    const debit = result.data?.revenue?.journal_proposal.journal_lines.find(
      (line) => line.debit_base > 0,
    );
    expect(debit?.account_id).toBe("acct-cash");
  });

  it("rejects closed fiscal period", () => {
    const result = saleAccountingService.proposeJournalsForSaleCompleted(
      source(),
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

  it("rejects inactive accounts", () => {
    const result = saleAccountingService.proposeJournalsForSaleCompleted(
      source(),
      accounting({
        accountsById: {
          "acct-ar": { id: "acct-ar", is_postable: true, is_active: false },
          "acct-revenue": {
            id: "acct-revenue",
            is_postable: true,
            is_active: true,
          },
          "acct-cogs": { id: "acct-cogs", is_postable: true, is_active: true },
          "acct-inventory": {
            id: "acct-inventory",
            is_postable: true,
            is_active: true,
          },
        },
      }),
    );

    expect(result.data).toBeNull();
    expect(result.error).toMatch(/inactive/i);
  });

  it("supports foreign currency sales via exchange_rate", () => {
    const result = saleAccountingService.proposeJournalsForSaleCompleted(
      source({ subtotal: 100, tax_total: 0, total: 100 }, 50),
      accounting({
        transactionCurrency: "USD",
        baseCurrency: "EUR",
        exchangeRate: 0.9,
      }),
    );

    expect(result.error).toBeNull();
    const revenueLines =
      result.data?.revenue?.journal_proposal.journal_lines ?? [];
    expect(revenueLines[0]?.debit_transaction).toBe(100);
    expect(revenueLines[0]?.debit_base).toBe(90);
    expect(
      result.data?.revenue?.journal_proposal.journal_entry.transaction_currency,
    ).toBe("USD");

    const cogsLines = result.data?.cogs?.journal_proposal.journal_lines ?? [];
    expect(cogsLines[0]?.debit_transaction).toBe(50);
    expect(cogsLines[0]?.debit_base).toBe(45);
  });

  it("fails when the posting rule is missing / inactive", () => {
    const inactive: PostingRule = createSaleCompletedRevenuePostingRule({
      is_active: false,
    });

    const result = saleAccountingService.proposeJournalsForSaleCompleted(
      source(),
      accounting({
        postingRulesByEvent: {
          sale_completed: [inactive],
        },
      }),
    );

    expect(result.data).toBeNull();
    expect(result.error).toMatch(/no active posting rule/i);
  });

  it("skips revenue proposal when revenue is zero and posts COGS only", () => {
    const result = saleAccountingService.proposeJournalsForSaleCompleted(
      source({ subtotal: 0, tax_total: 0, total: 0 }, 25),
      accounting(),
    );

    expect(result.error).toBeNull();
    expect(result.data?.revenue).toBeNull();
    expect(result.data?.cogs).not.toBeNull();
    expect(proposeSpy).toHaveBeenCalledTimes(1);
    expect(proposeSpy.mock.calls[0]?.[0].event.event_type).toBe(
      "cogs_recognized",
    );
  });

  it("skips COGS proposal when cost is zero and posts revenue only", () => {
    const result = saleAccountingService.proposeJournalsForSaleCompleted(
      source(undefined, 0),
      accounting(),
    );

    expect(result.error).toBeNull();
    expect(result.data?.revenue).not.toBeNull();
    expect(result.data?.cogs).toBeNull();
    expect(proposeSpy).toHaveBeenCalledTimes(1);
    expect(proposeSpy.mock.calls[0]?.[0].event.event_type).toBe(
      "sale_completed",
    );
  });

  it("rejects when both revenue and COGS are zero", () => {
    const result = saleAccountingService.proposeJournalsForSaleCompleted(
      source({ subtotal: 0, tax_total: 0, total: 0 }, 0),
      accounting(),
    );

    expect(result.data).toBeNull();
    expect(result.error).toMatch(/zero revenue and zero COGS/i);
    expect(proposeSpy).not.toHaveBeenCalled();
  });

  it("rejects duplicate posting for already posted sale events", () => {
    const result = saleAccountingService.proposeJournalsForSaleCompleted(
      source(),
      accounting({
        alreadyPostedIdempotencyKeys: ["sale_completed:sale-1"],
      }),
    );

    expect(result.data).toBeNull();
    expect(result.error).toMatch(/already been posted/i);
    expect(proposeSpy).not.toHaveBeenCalled();
  });

  it("rejects draft sales", () => {
    const result = saleAccountingService.proposeJournalsForSaleCompleted(
      source({ status: "draft", confirmed_at: null }),
      accounting(),
    );

    expect(result.data).toBeNull();
    expect(result.error).toMatch(/confirmed or paid/i);
  });

  it("builds sale_completed and cogs_recognized events with sales metadata", () => {
    const revenueEvent = saleAccountingService.buildSaleCompletedBusinessEvent(
      sale(),
      accounting(),
    );
    const cogsEvent = saleAccountingService.buildCogsRecognizedBusinessEvent(
      sale(),
      40,
      accounting(),
    );

    expect(revenueEvent.error).toBeNull();
    expect(revenueEvent.data?.event_type).toBe("sale_completed");
    expect(revenueEvent.data?.source_module).toBe("sales");
    expect(revenueEvent.data?.amounts.net_amount).toBe(100);
    expect(revenueEvent.data?.idempotency_key).toBe("sale_completed:sale-1");

    expect(cogsEvent.error).toBeNull();
    expect(cogsEvent.data?.event_type).toBe("cogs_recognized");
    expect(cogsEvent.data?.amounts.cogs_amount).toBe(40);
    expect(cogsEvent.data?.idempotency_key).toBe("cogs_recognized:sale-1");
  });

  it("exposes Accounting-owned rule factories without Sales owning rules", () => {
    expect(createSaleCompletedRevenuePostingRule().event_type).toBe(
      "sale_completed",
    );
    expect(createCogsRecognizedPostingRule().event_type).toBe(
      "cogs_recognized",
    );
  });
});
