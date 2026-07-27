/**
 * Sales → Accounting integration coverage (DEV-093 / DEV-109).
 *
 * Sale Completed → sale_completed + cogs_recognized
 * → Operational Accounting Integration → propose / post journals.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AccountRoleBinding,
  FiscalPeriod,
  PostingRule,
} from "@/types/accounting";
import { postingService } from "@/features/accounting/services/posting-service";
import type { SaleAccountingContext } from "../types/sale-accounting";
import type { SaleWithLines } from "../types/sale";
import { stableBusinessEventId } from "../utils/stable-business-event-id";
import {
  createCogsRecognizedPostingRule,
  createSaleCompletedRevenuePostingRule,
} from "./sale-completed-posting-rule";

const { proposeSpy, postSpy, supabaseMock } = vi.hoisted(() => ({
  proposeSpy: vi.fn(),
  postSpy: vi.fn(),
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
        post: async (
          ...args: Parameters<
            typeof actual.operationalAccountingIntegrationService.post
          >
        ) => {
          postSpy(...args);
          return actual.operationalAccountingIntegrationService.post(...args);
        },
      },
    };
  },
);

vi.mock("@/features/accounting/services/posting-service", async () => {
  const actual = await vi.importActual<
    typeof import("@/features/accounting/services/posting-service")
  >("@/features/accounting/services/posting-service");
  return {
    postingService: {
      ...actual.postingService,
      postJournalProposal: vi.fn(),
      rejectLedgerMutation: actual.postingService.rejectLedgerMutation,
    },
  };
});

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
      id: "bind-vat-output",
      role: "vat_output",
      account_id: "acct-vat-output",
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
      id: "bind-fg",
      role: "finished_goods_inventory",
      account_id: "acct-fg",
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
      "acct-vat-output": {
        id: "acct-vat-output",
        is_postable: true,
        is_active: true,
      },
      "acct-cogs": { id: "acct-cogs", is_postable: true, is_active: true },
      "acct-fg": { id: "acct-fg", is_postable: true, is_active: true },
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

function mockPostedJournal(businessEventId: string) {
  return {
    data: {
      journal_entry: {
        id: "journal-1",
        business_event_id: businessEventId,
        transaction_id: null,
        fiscal_period_id: "period-1",
        entry_date: "2026-07-26",
        memo: null,
        status: "posted" as const,
        posting_number: "JE-2026-000100",
        transaction_currency: "EUR",
        base_currency: "EUR",
        exchange_rate: 1,
        reversal_of_journal_entry_id: null,
        posted_at: "2026-07-26T12:00:00.000Z",
        created_at: "2026-07-26T12:00:00.000Z",
      },
      journal_lines: [],
      ledger_entries: [],
      posting_number: "JE-2026-000100",
      posting_date: "2026-07-26",
      fiscal_period_id: "period-1",
    },
    error: null,
  };
}

describe("saleAccountingService (DEV-093 / DEV-109)", () => {
  beforeEach(() => {
    proposeSpy.mockClear();
    postSpy.mockClear();
    vi.mocked(postingService.postJournalProposal).mockReset();
  });

  it("posts revenue: Dr AR (gross) / Cr Revenue (net) / Cr VAT Output (tax)", () => {
    const result = saleAccountingService.proposeJournalsForSaleCompleted(
      source(),
      accounting(),
    );

    expect(result.error).toBeNull();
    expect(result.data?.revenue).not.toBeNull();

    const lines = result.data?.revenue?.journal_proposal.journal_lines ?? [];
    const debit = lines.find((line) => line.account_id === "acct-ar");
    const revenue = lines.find((line) => line.account_id === "acct-revenue");
    const vat = lines.find((line) => line.account_id === "acct-vat-output");

    expect(debit?.debit_base).toBe(121);
    expect(revenue?.credit_base).toBe(100);
    expect(vat?.credit_base).toBe(21);
  });

  it("posts COGS: Dr Cost of Goods Sold / Cr Finished Goods Inventory", () => {
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
    expect(credit?.account_id).toBe("acct-fg");
    expect(debit?.debit_base).toBe(40);
    expect(credit?.credit_base).toBe(40);
  });

  it("successfully posts sale journals through Posting Service", async () => {
    vi.mocked(postingService.postJournalProposal)
      .mockResolvedValueOnce(
        mockPostedJournal(stableBusinessEventId("sale_completed:sale-1")),
      )
      .mockResolvedValueOnce(
        mockPostedJournal(stableBusinessEventId("cogs_recognized:sale-1")),
      );

    const result = await saleAccountingService.postJournalsForSaleCompleted(
      source(),
      accounting(),
    );

    expect(result.error).toBeNull();
    expect(postSpy).toHaveBeenCalledTimes(2);
    expect(postSpy.mock.calls[0]?.[0]).toMatchObject({
      mode: "post",
      event: {
        event_type: "sale_completed",
        id: stableBusinessEventId("sale_completed:sale-1"),
        source_document_id: "sale-1",
        amounts: {
          gross_amount: 121,
          net_amount: 100,
          tax_amount: 21,
        },
      },
      metadata: {
        tags: { sale_id: "sale-1", journal: "revenue" },
      },
    });
    expect(postSpy.mock.calls[1]?.[0]).toMatchObject({
      mode: "post",
      event: {
        event_type: "cogs_recognized",
        id: stableBusinessEventId("cogs_recognized:sale-1"),
        amounts: { cogs_amount: 40 },
      },
    });
    expect(result.data?.revenue?.mode).toBe("post");
    expect(result.data?.cogs?.mode).toBe("post");
    expect(result.data?.revenue?.posted_journal?.posting_number).toBe(
      "JE-2026-000100",
    );
    expect(postingService.postJournalProposal).toHaveBeenCalledTimes(2);
  });

  it("protects against duplicate posting (in-memory idempotency keys)", async () => {
    const result = await saleAccountingService.postJournalsForSaleCompleted(
      source(),
      accounting({
        alreadyPostedIdempotencyKeys: ["sale_completed:sale-1"],
      }),
    );

    expect(result.data).toBeNull();
    expect(result.error).toMatch(/already been posted/i);
    expect(postSpy).not.toHaveBeenCalled();
  });

  it("protects against duplicate posting (Posting Service ALREADY_POSTED)", async () => {
    vi.mocked(postingService.postJournalProposal).mockResolvedValue({
      data: null,
      error: "Journal proposal has already been posted.",
    });

    const result = await saleAccountingService.postJournalsForSaleCompleted(
      source(),
      accounting(),
    );

    expect(result.data).toBeNull();
    expect(result.error).toMatch(/already been posted/i);
    expect(postSpy).toHaveBeenCalledTimes(1);
  });

  it("fails when a required account role binding is missing", async () => {
    const result = await saleAccountingService.postJournalsForSaleCompleted(
      source(),
      accounting({
        accountRoleBindings: bindings().filter(
          (row) => row.role !== "vat_output",
        ),
      }),
    );

    expect(result.data).toBeNull();
    expect(result.error).toMatch(/no active account binding/i);
    expect(postingService.postJournalProposal).not.toHaveBeenCalled();
  });

  it("skips revenue posting when revenue is zero and posts COGS only", async () => {
    vi.mocked(postingService.postJournalProposal).mockResolvedValue(
      mockPostedJournal(stableBusinessEventId("cogs_recognized:sale-1")),
    );

    const result = await saleAccountingService.postJournalsForSaleCompleted(
      source({ subtotal: 0, tax_total: 0, total: 0 }, 25),
      accounting(),
    );

    expect(result.error).toBeNull();
    expect(result.data?.revenue).toBeNull();
    expect(result.data?.cogs).not.toBeNull();
    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(postSpy.mock.calls[0]?.[0].event.event_type).toBe(
      "cogs_recognized",
    );
  });

  it("skips COGS posting when cost is zero and posts revenue only", async () => {
    vi.mocked(postingService.postJournalProposal).mockResolvedValue(
      mockPostedJournal(stableBusinessEventId("sale_completed:sale-1")),
    );

    const result = await saleAccountingService.postJournalsForSaleCompleted(
      source(undefined, 0),
      accounting(),
    );

    expect(result.error).toBeNull();
    expect(result.data?.revenue).not.toBeNull();
    expect(result.data?.cogs).toBeNull();
    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(postSpy.mock.calls[0]?.[0].event.event_type).toBe("sale_completed");
  });

  it("rejects when both revenue and COGS are zero", async () => {
    const result = await saleAccountingService.postJournalsForSaleCompleted(
      source({ subtotal: 0, tax_total: 0, total: 0 }, 0),
      accounting(),
    );

    expect(result.data).toBeNull();
    expect(result.error).toMatch(/zero revenue and zero COGS/i);
    expect(postSpy).not.toHaveBeenCalled();
  });

  it("rejects draft sales", async () => {
    const result = await saleAccountingService.postJournalsForSaleCompleted(
      source({ status: "draft", confirmed_at: null }),
      accounting(),
    );

    expect(result.data).toBeNull();
    expect(result.error).toMatch(/confirmed or paid/i);
  });

  it("keeps historical postings immutable (ledger update/delete rejected)", () => {
    expect(() =>
      postingService.rejectLedgerMutation("update"),
    ).toThrow(/append-only|immutable|does not allow/i);
  });

  it("builds events with stable business_event_id linked to sale id", () => {
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
    expect(revenueEvent.data?.id).toBe(
      stableBusinessEventId("sale_completed:sale-1"),
    );
    expect(revenueEvent.data?.source_document_id).toBe("sale-1");
    expect(revenueEvent.data?.amounts.tax_amount).toBe(21);

    expect(cogsEvent.error).toBeNull();
    expect(cogsEvent.data?.id).toBe(
      stableBusinessEventId("cogs_recognized:sale-1"),
    );
    expect(cogsEvent.data?.amounts.cogs_amount).toBe(40);
  });

  it("returns combined revenue + COGS propose results", () => {
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
    expect(result.data?.total_cogs).toBe(40);
  });

  it("reuses the generic Accounting integration framework twice on propose", () => {
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
  });

  it("supports cash settlement debit via revenueDebitRole", () => {
    const result = saleAccountingService.proposeJournalsForSaleCompleted(
      source({ tax_total: 0, total: 100 }),
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
      source({ tax_total: 0, total: 100 }),
      accounting({
        accountsById: {
          "acct-ar": { id: "acct-ar", is_postable: true, is_active: false },
          "acct-revenue": {
            id: "acct-revenue",
            is_postable: true,
            is_active: true,
          },
          "acct-vat-output": {
            id: "acct-vat-output",
            is_postable: true,
            is_active: true,
          },
          "acct-cogs": { id: "acct-cogs", is_postable: true, is_active: true },
          "acct-fg": { id: "acct-fg", is_postable: true, is_active: true },
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

  it("skips VAT Output line when tax_total is zero (frozen)", () => {
    const result = saleAccountingService.proposeJournalsForSaleCompleted(
      source({ tax_total: 0, total: 100 }),
      accounting(),
    );

    expect(result.error).toBeNull();
    const lines = result.data?.revenue?.journal_proposal.journal_lines ?? [];
    expect(lines.some((line) => line.account_id === "acct-vat-output")).toBe(
      false,
    );
    expect(lines.find((line) => line.account_id === "acct-ar")?.debit_base).toBe(
      100,
    );
  });

  it("exposes Accounting-owned rule factories without Sales owning rules", () => {
    expect(createSaleCompletedRevenuePostingRule().event_type).toBe(
      "sale_completed",
    );
    expect(createCogsRecognizedPostingRule().event_type).toBe(
      "cogs_recognized",
    );
  });

  describe("getSaleCompletedPostingStatus (DEV-111)", () => {
    function mockJournalLookup(result: {
      data: Array<{ id: string; status: string; business_event_id: string }> | null;
      error: { message: string } | null;
    }) {
      const limit = vi.fn().mockResolvedValue(result);
      const eqStatus = vi.fn(() => ({ limit }));
      const inEvent = vi.fn(() => ({ eq: eqStatus }));
      const select = vi.fn(() => ({ in: inEvent }));
      supabaseMock.from.mockReturnValue({ select });
      return { select, inEvent, eqStatus, limit };
    }

    it("returns posted when a posted journal exists for the sale", async () => {
      mockJournalLookup({
        data: [
          {
            id: "je-1",
            status: "posted",
            business_event_id: stableBusinessEventId("sale_completed:sale-1"),
          },
        ],
        error: null,
      });

      const result =
        await saleAccountingService.getSaleCompletedPostingStatus("sale-1");

      expect(result.error).toBeNull();
      expect(result.data).toBe("posted");
      expect(supabaseMock.from).toHaveBeenCalledWith("journal_entries");
    });

    it("returns pending when no journal posting exists", async () => {
      mockJournalLookup({ data: [], error: null });

      const result =
        await saleAccountingService.getSaleCompletedPostingStatus("sale-1");

      expect(result.error).toBeNull();
      expect(result.data).toBe("pending");
    });

    it("returns pending when journal_entries table is unavailable", async () => {
      mockJournalLookup({
        data: null,
        error: { message: "relation journal_entries does not exist" },
      });

      const result =
        await saleAccountingService.getSaleCompletedPostingStatus("sale-1");

      expect(result.error).toBeNull();
      expect(result.data).toBe("pending");
    });
  });
});
