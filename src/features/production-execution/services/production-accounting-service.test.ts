/**
 * Production → Accounting integration coverage (DEV-094).
 *
 * Production Completed / Adjusted → generic Operational Accounting Integration
 * → Journal Proposal. No ledger persistence from Production.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AccountRoleBinding,
  FiscalPeriod,
  PostingRule,
} from "@/types/accounting";
import type {
  ProductionAccountingContext,
  ProductionAdjustedAccountingSource,
  ProductionCompletedAccountingSource,
} from "../types/production-accounting";
import {
  createProductionAdjustedPostingRule,
  createProductionCompletedPostingRule,
} from "./production-completed-posting-rule";

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

describe("productionAccountingService (DEV-094)", () => {
  beforeEach(() => {
    proposeSpy.mockClear();
  });

  it("posts production completion: Dr Finished Goods / Cr Raw Materials", () => {
    const result =
      productionAccountingService.proposeJournalForProductionCompleted(
        completedSource(),
        accounting(),
      );

    expect(result.error).toBeNull();
    expect(result.data?.event_type).toBe("production_completed");

    const lines =
      result.data?.postingResult.journal_proposal.journal_lines ?? [];
    const debit = lines.find((line) => line.debit_base > 0);
    const credit = lines.find((line) => line.credit_base > 0);

    expect(debit?.account_id).toBe("acct-fg");
    expect(credit?.account_id).toBe("acct-rm");
    expect(debit?.debit_base).toBe(80);
    expect(credit?.credit_base).toBe(80);
  });

  it("reuses the generic Accounting integration framework", () => {
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
    expect(
      result.data?.postingResult.journal_proposal.journal_entry
        .transaction_currency,
    ).toBe("USD");
  });

  it("rejects duplicate posting for an already posted production event", () => {
    const result =
      productionAccountingService.proposeJournalForProductionCompleted(
        completedSource(),
        accounting({
          alreadyPostedIdempotencyKeys: ["production_completed:session-1"],
        }),
      );

    expect(result.data).toBeNull();
    expect(result.error).toMatch(/already been posted/i);
    expect(proposeSpy).not.toHaveBeenCalled();
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
    expect(proposeSpy.mock.calls[0]?.[0]).toMatchObject({
      event: { event_type: "production_adjusted" },
      metadata: {
        idempotency_key: "production_adjusted:session-1:adj-1",
      },
    });

    const lines =
      result.data?.postingResult.journal_proposal.journal_lines ?? [];
    expect(lines.find((line) => line.debit_base > 0)?.account_id).toBe(
      "acct-fg",
    );
    expect(lines.find((line) => line.credit_base > 0)?.account_id).toBe(
      "acct-rm",
    );
  });

  it("keeps production_adjusted rules configurable for future variance", () => {
    const custom = createProductionAdjustedPostingRule({
      id: "custom-production-adjusted",
      description: "Future variance-ready override",
      priority: 200,
    });

    const result =
      productionAccountingService.proposeJournalForProductionAdjusted(
        adjustedSource(),
        accounting({
          postingRulesByEvent: {
            production_adjusted: [custom],
          },
        }),
      );

    expect(result.error).toBeNull();
    expect(result.data?.postingResult.journal_proposal.rule_id).toBe(
      "custom-production-adjusted",
    );
  });

  it("builds production_completed event with production-execution metadata", () => {
    const eventResult =
      productionAccountingService.buildProductionCompletedBusinessEvent(
        completedSource(),
        accounting(),
      );

    expect(eventResult.error).toBeNull();
    expect(eventResult.data?.event_type).toBe("production_completed");
    expect(eventResult.data?.source_module).toBe("production-execution");
    expect(eventResult.data?.source_document_type).toBe("production_session");
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
});
