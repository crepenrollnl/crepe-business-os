/**
 * Operational Accounting Integration Framework coverage (DEV-092).
 *
 * Proves:
 *   - Purchases-shaped events work through the generic intake
 *   - Invalid events / requests are rejected
 *   - Posting results are propagated correctly
 *   - Accounting remains the only persistence owner
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AccountRoleBinding,
  FiscalPeriod,
  PostingRule,
} from "@/types/accounting";
import type { OperationalPostingRequest } from "../types/operational-integration";
import {
  createBusinessEvent,
  createPostingMetadata,
} from "../utils/business-event-factory";
import { createPurchaseReceivedPostingRule } from "../rules/purchase-received-posting-rule";

const postJournalProposalMock = vi.fn();

vi.mock("./posting-service", () => ({
  postingService: {
    postJournalProposal: (...args: unknown[]) =>
      postJournalProposalMock(...args),
    rejectLedgerMutation: vi.fn(),
  },
}));

import { operationalAccountingIntegrationService } from "./operational-accounting-integration-service";

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
      id: "bind-vat-input",
      role: "vat_input",
      account_id: "acct-vat-input",
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

function buildPurchaseReceivedRequest(
  overrides?: Partial<OperationalPostingRequest>,
): OperationalPostingRequest {
  let seq = 0;
  const createId = () => {
    seq += 1;
    return `id-${seq}`;
  };

  const eventResult = createBusinessEvent({
    event_type: "purchase_received",
    source_module: "purchases",
    source_document_type: "purchase",
    source_document_id: "purchase-1",
    transaction_id: "txn-1",
    occurred_at: "2026-07-26T09:00:00.000Z",
    transaction_currency: "EUR",
    base_currency: "EUR",
    exchange_rate: 1,
    rate_date: "2026-07-26",
    amounts: {
      gross_amount: 240,
      net_amount: 200,
      tax_amount: 40,
      cogs_amount: null,
      discount_amount: null,
      shipping_amount: null,
      other_amount: null,
    },
    idempotency_key: "purchase_received:purchase-1",
    nowIso: "2026-07-26T12:00:00.000Z",
    createId,
  });

  if (eventResult.error || !eventResult.data) {
    throw new Error(eventResult.error ?? "Failed to build fixture event");
  }

  const event = eventResult.data;

  return {
    event,
    metadata: createPostingMetadata({
      event,
      requested_at: "2026-07-26T12:00:00.000Z",
      correlation_id: "txn-1",
    }),
    context: {
      fiscalPeriod: period(),
      accountRoleBindings: bindings(),
      nowIso: "2026-07-26T12:00:00.000Z",
      createId,
      accountsById: {
        "acct-inventory": {
          id: "acct-inventory",
          is_postable: true,
          is_active: true,
        },
        "acct-vat-input": {
          id: "acct-vat-input",
          is_postable: true,
          is_active: true,
        },
        "acct-ap": {
          id: "acct-ap",
          is_postable: true,
          is_active: true,
        },
      },
    },
    mode: "propose",
    ...overrides,
  };
}

describe("operationalAccountingIntegrationService (DEV-092)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    postJournalProposalMock.mockReset();
  });

  it("proposes a purchase_received journal through the generic framework", () => {
    const result = operationalAccountingIntegrationService.propose(
      buildPurchaseReceivedRequest(),
    );

    expect(result.error).toBeNull();
    expect(result.data?.mode).toBe("propose");
    expect(result.data?.event_type).toBe("purchase_received");
    expect(result.data?.metadata.source_module).toBe("purchases");
    expect(result.data?.posted_journal).toBeNull();
    expect(result.data?.journal_proposal.journal_lines).toHaveLength(3);

    const inventory = result.data?.journal_proposal.journal_lines.find(
      (line) => line.account_id === "acct-inventory",
    );
    const vat = result.data?.journal_proposal.journal_lines.find(
      (line) => line.account_id === "acct-vat-input",
    );
    const ap = result.data?.journal_proposal.journal_lines.find(
      (line) => line.account_id === "acct-ap",
    );
    expect(inventory?.debit_base).toBe(200);
    expect(vat?.debit_base).toBe(40);
    expect(ap?.credit_base).toBe(240);
    expect(postJournalProposalMock).not.toHaveBeenCalled();
  });

  it("resolves default purchase_received rules when overrides are omitted", () => {
    const request = buildPurchaseReceivedRequest();
    delete request.context.postingRules;

    const result = operationalAccountingIntegrationService.propose(request);

    expect(result.error).toBeNull();
    expect(result.data?.journal_proposal.rule_id).toBe(
      createPurchaseReceivedPostingRule().id,
    );
  });

  it("rejects invalid events with metadata mismatch", () => {
    const request = buildPurchaseReceivedRequest();
    request.metadata = {
      ...request.metadata,
      source_document_id: "other-purchase",
    };

    const result = operationalAccountingIntegrationService.propose(request);

    expect(result.data).toBeNull();
    expect(result.error).toMatch(/source_document_id must match/i);
    expect(postJournalProposalMock).not.toHaveBeenCalled();
  });

  it("rejects invalid factory input for future modules", () => {
    const eventResult = createBusinessEvent({
      event_type: "sale_completed",
      source_module: "sales",
      source_document_type: "sale",
      source_document_id: "sale-1",
      transaction_id: null,
      occurred_at: "2026-07-26T10:00:00.000Z",
      transaction_currency: "EUR",
      base_currency: "EUR",
      exchange_rate: 0,
      rate_date: "2026-07-26",
      amounts: {
        gross_amount: 10,
        net_amount: 10,
        tax_amount: 0,
        cogs_amount: null,
        discount_amount: null,
        shipping_amount: null,
        other_amount: null,
      },
    });

    expect(eventResult.data).toBeNull();
    expect(eventResult.error).toMatch(/exchange rate/i);
  });

  it("rejects posting when no active rule exists for the event type", () => {
    const inactive: PostingRule = createPurchaseReceivedPostingRule({
      is_active: false,
    });
    const request = buildPurchaseReceivedRequest({
      context: {
        ...buildPurchaseReceivedRequest().context,
        postingRules: [inactive],
      },
    });

    const result = operationalAccountingIntegrationService.propose(request);

    expect(result.data).toBeNull();
    expect(result.error).toMatch(/no active posting rule/i);
  });

  it("propagates posting results with metadata echo", () => {
    const request = buildPurchaseReceivedRequest();
    const result = operationalAccountingIntegrationService.propose(request);

    expect(result.error).toBeNull();
    expect(result.data?.business_event_id).toBe(request.event.id);
    expect(result.data?.metadata).toEqual(request.metadata);
    expect(result.data?.journal_proposal.event_id).toBe(request.event.id);
  });

  it("persists only through Posting Service in post mode", async () => {
    postJournalProposalMock.mockResolvedValue({
      data: {
        journal_entry: { id: "journal-1", status: "posted" },
        journal_lines: [],
        ledger_entries: [],
        posting_number: "JE-2026-000001",
        posting_date: "2026-07-26",
        fiscal_period_id: "period-1",
      },
      error: null,
    });

    const result = await operationalAccountingIntegrationService.post(
      buildPurchaseReceivedRequest({ mode: "post" }),
    );

    expect(result.error).toBeNull();
    expect(result.data?.mode).toBe("post");
    expect(result.data?.posted_journal?.posting_number).toBe("JE-2026-000001");
    expect(postJournalProposalMock).toHaveBeenCalledTimes(1);
    expect(postJournalProposalMock.mock.calls[0]?.[0]).toMatchObject({
      event_id: expect.any(String),
      journal_entry: expect.objectContaining({ status: "posted" }),
    });
  });

  it("keeps propose mode free of ledger persistence", async () => {
    const result = await operationalAccountingIntegrationService.process(
      buildPurchaseReceivedRequest({ mode: "propose" }),
    );

    expect(result.error).toBeNull();
    expect(result.data?.mode).toBe("propose");
    expect(result.data?.posted_journal).toBeNull();
    expect(postJournalProposalMock).not.toHaveBeenCalled();
  });
});
