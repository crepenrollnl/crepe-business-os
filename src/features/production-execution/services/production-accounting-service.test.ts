/**
 * Production → Accounting integration coverage (DEV-094 / DEV-105).
 *
 * Production Completed → propose / post through Operational Accounting Integration.
 * Post mode persists journal + ledger via Posting Service (mocked).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AccountRoleBinding,
  FiscalPeriod,
  PostingRule,
} from "@/types/accounting";
import { postingService } from "@/features/accounting/services/posting-service";
import type {
  ProductionAccountingContext,
  ProductionAdjustedAccountingSource,
  ProductionCompletedAccountingSource,
} from "../types/production-accounting";
import { stableBusinessEventId } from "../utils/stable-business-event-id";
import {
  createProductionAdjustedPostingRule,
  createProductionCompletedPostingRule,
} from "./production-completed-posting-rule";

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

import { productionAccountingService } from "./production-accounting-service";

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

function completedSource(
  overrides?: Partial<ProductionCompletedAccountingSource>,
): ProductionCompletedAccountingSource {
  return {
    session_id: "session-1",
    transaction_id: "txn-prod-1",
    completed_at: "2026-07-26T14:00:00.000Z",
    total_cost: 80,
    total_produced_quantity: 20,
    batch_count: 2,
    batch_ids: ["batch-1", "batch-2"],
    session_status: "completed",
    ...overrides,
  };
}

function adjustedSource(
  overrides?: Partial<ProductionAdjustedAccountingSource>,
): ProductionAdjustedAccountingSource {
  return {
    session_id: "session-1",
    adjustment_id: "adj-1",
    occurred_at: "2026-07-26T15:00:00.000Z",
    adjustment_amount: 12,
    transaction_id: "txn-adj-1",
    ...overrides,
  };
}

function bindings(): AccountRoleBinding[] {
  return [
    {
      id: "bind-fg",
      role: "finished_goods_inventory",
      account_id: "acct-fg",
      effective_from: "2020-01-01",
      effective_to: null,
      is_active: true,
      created_at: "2020-01-01T00:00:00.000Z",
    },
    {
      id: "bind-rm",
      role: "inventory_asset",
      account_id: "acct-rm",
      effective_from: "2020-01-01",
      effective_to: null,
      is_active: true,
      created_at: "2020-01-01T00:00:00.000Z",
    },
  ];
}

function accounting(
  overrides?: Partial<ProductionAccountingContext>,
): ProductionAccountingContext {
  let seq = 0;
  return {
    fiscalPeriod: period(),
    accountRoleBindings: bindings(),
    baseCurrency: "EUR",
    transactionCurrency: "EUR",
    exchangeRate: 1,
    rateDate: "2026-07-26",
    nowIso: "2026-07-26T16:00:00.000Z",
    createId: () => {
      seq += 1;
      return `id-${seq}`;
    },
    accountsById: {
      "acct-fg": { id: "acct-fg", is_postable: true, is_active: true },
      "acct-rm": { id: "acct-rm", is_postable: true, is_active: true },
    },
    ...overrides,
  };
}

describe("productionAccountingService (DEV-094 / DEV-105)", () => {
  beforeEach(() => {
    proposeSpy.mockClear();
    postSpy.mockClear();
    vi.mocked(postingService.postJournalProposal).mockReset();
  });

  it("proposes production completion: Dr Finished Goods / Cr Raw Materials", () => {
    const result =
      productionAccountingService.proposeJournalForProductionCompleted(
        completedSource(),
        accounting(),
      );

    expect(result.error).toBeNull();
    expect(result.data?.event_type).toBe("production_completed");
    expect(result.data?.batch_ids).toEqual(["batch-1", "batch-2"]);

    const lines =
      result.data?.postingResult.journal_proposal.journal_lines ?? [];
    const debit = lines.find((line) => line.debit_base > 0);
    const credit = lines.find((line) => line.credit_base > 0);

    expect(debit?.account_id).toBe("acct-fg");
    expect(credit?.account_id).toBe("acct-rm");
    expect(debit?.debit_base).toBe(80);
    expect(credit?.credit_base).toBe(80);
  });

  it("successfully posts production completion through Posting Service", async () => {
    vi.mocked(postingService.postJournalProposal).mockResolvedValue({
      data: {
        journal_entry: {
          id: "journal-1",
          business_event_id: stableBusinessEventId(
            "production_completed:session-1",
          ),
          transaction_id: "txn-prod-1",
          fiscal_period_id: "period-1",
          entry_date: "2026-07-26",
          memo: null,
          status: "posted",
          posting_number: "JE-2026-000001",
          transaction_currency: "EUR",
          base_currency: "EUR",
          exchange_rate: 1,
          reversal_of_journal_entry_id: null,
          posted_at: "2026-07-26T16:00:00.000Z",
          created_at: "2026-07-26T16:00:00.000Z",
        },
        journal_lines: [],
        ledger_entries: [],
        posting_number: "JE-2026-000001",
        posting_date: "2026-07-26",
        fiscal_period_id: "period-1",
      },
      error: null,
    });

    const result =
      await productionAccountingService.postJournalForProductionCompleted(
        completedSource(),
        accounting(),
      );

    expect(result.error).toBeNull();
    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(postSpy.mock.calls[0]?.[0]).toMatchObject({
      mode: "post",
      event: {
        event_type: "production_completed",
        id: stableBusinessEventId("production_completed:session-1"),
        amounts: { other_amount: 80 },
      },
      metadata: {
        tags: {
          batch_ids: "batch-1,batch-2",
          journal: "production_completed",
        },
      },
    });
    expect(result.data?.postingResult.mode).toBe("post");
    expect(result.data?.postingResult.posted_journal?.posting_number).toBe(
      "JE-2026-000001",
    );
    expect(postingService.postJournalProposal).toHaveBeenCalledTimes(1);
  });

  it("protects against duplicate posting (in-memory idempotency keys)", async () => {
    const result =
      await productionAccountingService.postJournalForProductionCompleted(
        completedSource(),
        accounting({
          alreadyPostedIdempotencyKeys: ["production_completed:session-1"],
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

    const result =
      await productionAccountingService.postJournalForProductionCompleted(
        completedSource(),
        accounting(),
      );

    expect(result.data).toBeNull();
    expect(result.error).toMatch(/already been posted/i);
    expect(postSpy).toHaveBeenCalledTimes(1);
  });

  it("fails when a required account role binding is missing", async () => {
    const result =
      await productionAccountingService.postJournalForProductionCompleted(
        completedSource(),
        accounting({
          accountRoleBindings: bindings().filter(
            (row) => row.role !== "finished_goods_inventory",
          ),
        }),
      );

    expect(result.data).toBeNull();
    expect(result.error).toMatch(/no active account binding/i);
    expect(postingService.postJournalProposal).not.toHaveBeenCalled();
  });

  it("rejects zero batch cost", async () => {
    const result =
      await productionAccountingService.postJournalForProductionCompleted(
        completedSource({ total_cost: 0 }),
        accounting(),
      );

    expect(result.data).toBeNull();
    expect(result.error).toMatch(/total cost greater than zero/i);
    expect(postSpy).not.toHaveBeenCalled();
  });

  it("rejects non-completed sessions", () => {
    const result =
      productionAccountingService.proposeJournalForProductionCompleted(
        {
          ...completedSource(),
          session_status: "in_progress" as unknown as "completed",
        },
        accounting(),
      );

    expect(result.data).toBeNull();
    expect(result.error).toMatch(/completed production session/i);
  });

  it("rejects missing production batches", () => {
    const result =
      productionAccountingService.proposeJournalForProductionCompleted(
        completedSource({ batch_ids: [] }),
        accounting(),
      );

    expect(result.data).toBeNull();
    expect(result.error).toMatch(/at least one production batch/i);
  });

  it("keeps historical postings immutable (ledger update/delete rejected)", () => {
    expect(() => postingService.rejectLedgerMutation("update")).toThrow(
      /immutable|not allowed|append/i,
    );
    expect(() => postingService.rejectLedgerMutation("delete")).toThrow(
      /immutable|not allowed|append/i,
    );
  });

  it("reuses the generic Accounting integration framework for propose", () => {
    const result =
      productionAccountingService.proposeJournalForProductionCompleted(
        completedSource(),
        accounting(),
      );

    expect(result.error).toBeNull();
    expect(proposeSpy).toHaveBeenCalledTimes(1);
    expect(proposeSpy.mock.calls[0]?.[0]).toMatchObject({
      mode: "propose",
      event: {
        event_type: "production_completed",
        source_module: "production-execution",
        source_document_id: "session-1",
      },
      metadata: {
        idempotency_key: "production_completed:session-1",
      },
    });
    expect(result.data?.postingResult.posted_journal).toBeNull();
  });

  it("rejects zero produced quantity", () => {
    const result =
      productionAccountingService.proposeJournalForProductionCompleted(
        completedSource({ total_produced_quantity: 0 }),
        accounting(),
      );

    expect(result.data).toBeNull();
    expect(result.error).toMatch(/produced quantity greater than zero/i);
    expect(proposeSpy).not.toHaveBeenCalled();
  });

  it("fails when the posting rule is missing / inactive", () => {
    const inactive: PostingRule = createProductionCompletedPostingRule({
      is_active: false,
    });

    const result =
      productionAccountingService.proposeJournalForProductionCompleted(
        completedSource(),
        accounting({
          postingRulesByEvent: {
            production_completed: [inactive],
          },
        }),
      );

    expect(result.data).toBeNull();
    expect(result.error).toMatch(/no active posting rule/i);
  });

  it("rejects inactive accounts", () => {
    const result =
      productionAccountingService.proposeJournalForProductionCompleted(
        completedSource(),
        accounting({
          accountsById: {
            "acct-fg": { id: "acct-fg", is_postable: true, is_active: false },
            "acct-rm": { id: "acct-rm", is_postable: true, is_active: true },
          },
        }),
      );

    expect(result.data).toBeNull();
    expect(result.error).toMatch(/inactive/i);
  });

  it("supports foreign currency material valuation via exchange_rate", () => {
    const result =
      productionAccountingService.proposeJournalForProductionCompleted(
        completedSource({ total_cost: 100 }),
        accounting({
          transactionCurrency: "USD",
          baseCurrency: "EUR",
          exchangeRate: 0.8,
        }),
      );

    expect(result.error).toBeNull();
    const lines =
      result.data?.postingResult.journal_proposal.journal_lines ?? [];
    expect(lines[0]?.debit_transaction).toBe(100);
    expect(lines[0]?.debit_base).toBe(80);
  });

  it("rejects closed fiscal period", () => {
    const result =
      productionAccountingService.proposeJournalForProductionCompleted(
        completedSource(),
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

  it("proposes production_adjusted through the framework without variance P&L", () => {
    const result =
      productionAccountingService.proposeJournalForProductionAdjusted(
        adjustedSource(),
        accounting(),
      );

    expect(result.error).toBeNull();
    expect(result.data?.event_type).toBe("production_adjusted");
    expect(proposeSpy).toHaveBeenCalledTimes(1);
  });

  it("builds production_completed event with stable idempotent event id", () => {
    const eventResult =
      productionAccountingService.buildProductionCompletedBusinessEvent(
        completedSource(),
        accounting(),
      );

    expect(eventResult.error).toBeNull();
    expect(eventResult.data?.id).toBe(
      stableBusinessEventId("production_completed:session-1"),
    );
    expect(eventResult.data?.amounts.other_amount).toBe(80);
    expect(eventResult.data?.idempotency_key).toBe(
      "production_completed:session-1",
    );
  });

  it("exposes Accounting-owned production rule factories", () => {
    expect(createProductionCompletedPostingRule().event_type).toBe(
      "production_completed",
    );
    expect(createProductionAdjustedPostingRule().event_type).toBe(
      "production_adjusted",
    );
  });

  describe("getProductionCompletedPostingStatus (DEV-106)", () => {
    function mockJournalLookup(result: {
      data: { id: string; status: string } | null;
      error: { message: string } | null;
    }) {
      const maybeSingle = vi.fn().mockResolvedValue(result);
      const eqStatus = vi.fn(() => ({ maybeSingle }));
      const eqEvent = vi.fn(() => ({ eq: eqStatus }));
      const select = vi.fn(() => ({ eq: eqEvent }));
      supabaseMock.from.mockReturnValue({ select });
      return { select, eqEvent, eqStatus, maybeSingle };
    }

    it("returns posted when a posted journal exists for the session", async () => {
      mockJournalLookup({
        data: { id: "je-1", status: "posted" },
        error: null,
      });

      const result =
        await productionAccountingService.getProductionCompletedPostingStatus(
          "session-1",
        );

      expect(result.error).toBeNull();
      expect(result.data).toBe("posted");
      expect(supabaseMock.from).toHaveBeenCalledWith("journal_entries");
    });

    it("returns pending when no journal posting exists", async () => {
      mockJournalLookup({ data: null, error: null });

      const result =
        await productionAccountingService.getProductionCompletedPostingStatus(
          "session-1",
        );

      expect(result.error).toBeNull();
      expect(result.data).toBe("pending");
    });

    it("returns pending when journal_entries table is unavailable", async () => {
      mockJournalLookup({
        data: null,
        error: { message: "relation journal_entries does not exist" },
      });

      const result =
        await productionAccountingService.getProductionCompletedPostingStatus(
          "session-1",
        );

      expect(result.error).toBeNull();
      expect(result.data).toBe("pending");
    });
  });
});
