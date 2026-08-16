/**
 * Posting Service coverage (DEV-091, extended for V1 plan item 8).
 *
 * postJournalProposals persists one or more Journal Proposals atomically
 * through a single call to post_journal_proposals (sql/091) — all the
 * fiscal-period/account/currency/rate/ALREADY_POSTED validation that used
 * to run as separate pre-persist TS queries now lives inside that RPC, so
 * these tests mock the RPC boundary rather than individual Supabase table
 * calls. Only shape/balance stay as a pure pre-check in TS (no DB access)
 * and are tested directly here — the SQL side gets its own manual
 * verification in Supabase SQL Editor (see task ПРОВЕРКА), not unit tests.
 *
 * postJournalProposal (singular) is a thin wrapper around
 * postJournalProposals([proposal]) kept for single-proposal callers
 * (Production) — its own tests confirm it delegates correctly and keeps
 * its historical (pre-batch) contract of failing hard on ALREADY_POSTED.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  JournalEntry,
  JournalLine,
  LedgerEntry,
} from "@/types/accounting";
import type { JournalProposal } from "../types/posting-persistence";

const { supabaseMock } = vi.hoisted(() => {
  const supabaseMock = {
    from: vi.fn(),
    rpc: vi.fn(),
    auth: {
      getUser: vi.fn(),
    },
  };
  return { supabaseMock };
});

vi.mock("@/lib/supabase", () => ({
  supabase: supabaseMock,
}));

import { postingService } from "./posting-service";

const JOURNAL_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EVENT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PERIOD_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ACCT_DR = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const ACCT_CR = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const LINE_DR = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const LINE_CR = "11111111-1111-4111-8111-111111111111";
const LEDGER_DR = "22222222-2222-4222-8222-222222222222";
const LEDGER_CR = "33333333-3333-4333-8333-333333333333";

const JOURNAL_ID_2 = "44444444-4444-4444-8444-444444444444";
const EVENT_ID_2 = "55555555-5555-4555-8555-555555555555";
const LINE_DR_2 = "66666666-6666-4666-8666-666666666666";
const LINE_CR_2 = "77777777-7777-4777-8777-777777777777";
const LEDGER_DR_2 = "88888888-8888-4888-8888-888888888888";
const LEDGER_CR_2 = "99999999-9999-4999-8999-999999999999";

const NOW = "2026-07-26T12:00:00.000Z";
const ENTRY_DATE = "2026-07-26";

function buildProposal(overrides?: Partial<JournalProposal>): JournalProposal {
  const journal: JournalEntry = {
    id: JOURNAL_ID,
    business_event_id: EVENT_ID,
    transaction_id: "txn-1",
    fiscal_period_id: PERIOD_ID,
    entry_date: ENTRY_DATE,
    memo: "Purchase received",
    status: "posted",
    posting_number: null,
    transaction_currency: "EUR",
    base_currency: "EUR",
    exchange_rate: 1,
    reversal_of_journal_entry_id: null,
    posted_at: NOW,
    created_at: NOW,
  };

  const journal_lines: JournalLine[] = [
    {
      id: LINE_DR,
      journal_entry_id: JOURNAL_ID,
      line_no: 1,
      account_id: ACCT_DR,
      description: "Inventory",
      debit_transaction: 100,
      credit_transaction: 0,
      debit_base: 100,
      credit_base: 0,
      tax_code: null,
    },
    {
      id: LINE_CR,
      journal_entry_id: JOURNAL_ID,
      line_no: 2,
      account_id: ACCT_CR,
      description: "AP",
      debit_transaction: 0,
      credit_transaction: 100,
      debit_base: 0,
      credit_base: 100,
      tax_code: null,
    },
  ];

  const ledger_entries: LedgerEntry[] = [
    {
      id: LEDGER_DR,
      journal_entry_id: JOURNAL_ID,
      journal_line_id: LINE_DR,
      fiscal_period_id: PERIOD_ID,
      account_id: ACCT_DR,
      entry_date: ENTRY_DATE,
      debit_base: 100,
      credit_base: 0,
      debit_transaction: 100,
      credit_transaction: 0,
      transaction_currency: "EUR",
      base_currency: "EUR",
      created_at: NOW,
    },
    {
      id: LEDGER_CR,
      journal_entry_id: JOURNAL_ID,
      journal_line_id: LINE_CR,
      fiscal_period_id: PERIOD_ID,
      account_id: ACCT_CR,
      entry_date: ENTRY_DATE,
      debit_base: 0,
      credit_base: 100,
      debit_transaction: 0,
      credit_transaction: 100,
      transaction_currency: "EUR",
      base_currency: "EUR",
      created_at: NOW,
    },
  ];

  return {
    event_id: EVENT_ID,
    rule_id: "rule-1",
    rule_version: 1,
    rule_priority: 100,
    journal_entry: journal,
    journal_lines,
    ledger_entries,
    ...overrides,
  };
}

function buildSecondProposal(): JournalProposal {
  const base = buildProposal();
  return {
    ...base,
    event_id: EVENT_ID_2,
    journal_entry: {
      ...base.journal_entry,
      id: JOURNAL_ID_2,
      business_event_id: EVENT_ID_2,
      memo: "COGS recognized",
    },
    journal_lines: [
      { ...base.journal_lines[0], id: LINE_DR_2, journal_entry_id: JOURNAL_ID_2 },
      { ...base.journal_lines[1], id: LINE_CR_2, journal_entry_id: JOURNAL_ID_2 },
    ],
    ledger_entries: [
      {
        ...base.ledger_entries[0],
        id: LEDGER_DR_2,
        journal_entry_id: JOURNAL_ID_2,
        journal_line_id: LINE_DR_2,
      },
      {
        ...base.ledger_entries[1],
        id: LEDGER_CR_2,
        journal_entry_id: JOURNAL_ID_2,
        journal_line_id: LINE_CR_2,
      },
    ],
  };
}

interface RpcProposalPayload {
  journal_entry: JournalEntry;
  journal_lines: JournalLine[];
  ledger_entries: LedgerEntry[];
}

function postedNowRow(
  payload: RpcProposalPayload,
  postingNumber: string,
  postingDate: string,
  nowIso: string,
) {
  return {
    status: "posted_now",
    business_event_id: payload.journal_entry.business_event_id,
    journal_entry_id: payload.journal_entry.id,
    posting_number: postingNumber,
    posting_date: postingDate,
    fiscal_period_id: payload.journal_entry.fiscal_period_id,
    journal_entry: {
      ...payload.journal_entry,
      status: "posted",
      posting_number: postingNumber,
      posted_at: nowIso,
      entry_date: postingDate,
    },
    journal_lines: payload.journal_lines,
    ledger_entries: payload.ledger_entries,
  };
}

function alreadyPostedRow(
  payload: RpcProposalPayload,
  postingNumber: string | null,
) {
  return {
    status: "already_posted",
    business_event_id: payload.journal_entry.business_event_id,
    journal_entry_id: payload.journal_entry.id,
    posting_number: postingNumber,
  };
}

/** Default happy-path mock: every proposal in the batch posts_now, in order. */
function installDefaultRpcMock() {
  supabaseMock.rpc.mockImplementation(
    async (fn: string, args: Record<string, unknown>) => {
      if (fn !== "post_journal_proposals") {
        return { data: null, error: { message: `Unexpected rpc: ${fn}` } };
      }

      const proposals = args.p_proposals as RpcProposalPayload[];
      const postingDate = args.p_posting_date as string;
      const nowIso = args.p_now as string;

      const rows = proposals.map((proposal, index) =>
        postedNowRow(
          proposal,
          `JE-2026-${String(index + 1).padStart(6, "0")}`,
          postingDate,
          nowIso,
        ),
      );

      return { data: rows, error: null };
    },
  );
}

describe("postingService.postJournalProposals (V1 plan item 8)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("posts a single proposal via one call to post_journal_proposals", async () => {
    installDefaultRpcMock();

    const result = await postingService.postJournalProposals(
      [buildProposal()],
      { postingDate: ENTRY_DATE, nowIso: NOW },
    );

    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(1);
    expect(result.data?.[0]?.status).toBe("posted_now");
    expect(result.data?.[0]?.record?.posting_number).toBe("JE-2026-000001");
    expect(result.data?.[0]?.record?.journal_entry.status).toBe("posted");
    expect(result.data?.[0]?.record?.journal_lines).toHaveLength(2);
    expect(result.data?.[0]?.record?.ledger_entries).toHaveLength(2);

    expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
    expect(supabaseMock.rpc).toHaveBeenCalledWith("post_journal_proposals", {
      p_proposals: [
        expect.objectContaining({
          journal_entry: expect.objectContaining({ id: JOURNAL_ID }),
        }),
      ],
      p_posting_date: ENTRY_DATE,
      p_now: NOW,
    });
  });

  it("posts multiple proposals atomically in a single RPC call, preserving order", async () => {
    installDefaultRpcMock();

    const result = await postingService.postJournalProposals(
      [buildProposal(), buildSecondProposal()],
      { postingDate: ENTRY_DATE, nowIso: NOW },
    );

    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(2);
    expect(result.data?.[0]?.business_event_id).toBe(EVENT_ID);
    expect(result.data?.[1]?.business_event_id).toBe(EVENT_ID_2);
    expect(result.data?.[0]?.record?.posting_number).toBe("JE-2026-000001");
    expect(result.data?.[1]?.record?.posting_number).toBe("JE-2026-000002");

    // One RPC call for the whole batch, not one per proposal.
    expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
    const call = supabaseMock.rpc.mock.calls[0];
    expect((call?.[1] as { p_proposals: unknown[] }).p_proposals).toHaveLength(2);
  });

  it("marks one already-posted proposal without failing the batch, and still lands the other", async () => {
    supabaseMock.rpc.mockImplementation(
      async (fn: string, args: Record<string, unknown>) => {
        if (fn !== "post_journal_proposals") {
          return { data: null, error: { message: `Unexpected rpc: ${fn}` } };
        }
        const [first, second] = args.p_proposals as RpcProposalPayload[];
        return {
          data: [
            alreadyPostedRow(first, "JE-2026-000001"),
            postedNowRow(second, "JE-2026-000002", ENTRY_DATE, NOW),
          ],
          error: null,
        };
      },
    );

    const result = await postingService.postJournalProposals(
      [buildProposal(), buildSecondProposal()],
      { postingDate: ENTRY_DATE, nowIso: NOW },
    );

    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(2);
    expect(result.data?.[0]?.status).toBe("already_posted");
    expect(result.data?.[0]?.record).toBeNull();
    expect(result.data?.[0]?.posting_number).toBe("JE-2026-000001");
    expect(result.data?.[1]?.status).toBe("posted_now");
    expect(result.data?.[1]?.record?.posting_number).toBe("JE-2026-000002");

    // Still exactly one RPC call — the RPC itself decides per-element
    // skip vs insert inside its own transaction, not the TS layer.
    expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
  });

  it("propagates a genuine RPC failure (e.g. closed fiscal period aborting the whole batch)", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: { message: "Fiscal period is not open for posting." },
    });

    const result = await postingService.postJournalProposals(
      [buildProposal(), buildSecondProposal()],
      { postingDate: ENTRY_DATE, nowIso: NOW },
    );

    expect(result.data).toBeNull();
    expect(result.error).toBe("Fiscal period is not open for posting.");
  });

  it("fails fast on an unbalanced proposal without calling the RPC", async () => {
    installDefaultRpcMock();

    const unbalanced = buildProposal({
      journal_lines: [
        { ...buildProposal().journal_lines[0], debit_base: 100 },
        { ...buildProposal().journal_lines[1], credit_base: 90 },
      ],
    });

    const result = await postingService.postJournalProposals([unbalanced], {
      postingDate: ENTRY_DATE,
      nowIso: NOW,
    });

    expect(result.data).toBeNull();
    expect(result.error).toMatch(/not balanced/i);
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it("fails fast on a structurally invalid proposal without calling the RPC", async () => {
    installDefaultRpcMock();

    const invalid = buildProposal({ journal_lines: [] });

    const result = await postingService.postJournalProposals([invalid], {
      postingDate: ENTRY_DATE,
      nowIso: NOW,
    });

    expect(result.data).toBeNull();
    expect(result.error).toMatch(/no journal lines/i);
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it("rejects an empty proposal list without calling the RPC", async () => {
    installDefaultRpcMock();

    const result = await postingService.postJournalProposals([], {
      postingDate: ENTRY_DATE,
      nowIso: NOW,
    });

    expect(result.data).toBeNull();
    expect(result.error).toMatch(/at least one journal proposal/i);
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it("fails if the RPC returns a different number of results than proposals sent", async () => {
    supabaseMock.rpc.mockImplementation(
      async (fn: string, args: Record<string, unknown>) => {
        if (fn !== "post_journal_proposals") {
          return { data: null, error: { message: `Unexpected rpc: ${fn}` } };
        }
        const [first] = args.p_proposals as RpcProposalPayload[];
        return { data: [postedNowRow(first, "JE-2026-000001", ENTRY_DATE, NOW)], error: null };
      },
    );

    const result = await postingService.postJournalProposals(
      [buildProposal(), buildSecondProposal()],
      { postingDate: ENTRY_DATE, nowIso: NOW },
    );

    expect(result.data).toBeNull();
    expect(result.error).toMatch(/unexpected number of results/i);
  });
});

describe("postingService.postJournalProposal (singular, thin wrapper)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delegates to postJournalProposals with a single-element array and unwraps the record", async () => {
    installDefaultRpcMock();

    const result = await postingService.postJournalProposal(buildProposal(), {
      postingDate: ENTRY_DATE,
      nowIso: NOW,
    });

    expect(result.error).toBeNull();
    expect(result.data?.posting_number).toBe("JE-2026-000001");
    expect(result.data?.journal_entry.status).toBe("posted");
    expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
    const call = supabaseMock.rpc.mock.calls[0];
    expect((call?.[1] as { p_proposals: unknown[] }).p_proposals).toHaveLength(1);
  });

  it("treats ALREADY_POSTED as a hard failure, matching the pre-batch contract", async () => {
    supabaseMock.rpc.mockImplementation(
      async (fn: string, args: Record<string, unknown>) => {
        if (fn !== "post_journal_proposals") {
          return { data: null, error: { message: `Unexpected rpc: ${fn}` } };
        }
        const [proposal] = args.p_proposals as RpcProposalPayload[];
        return { data: [alreadyPostedRow(proposal, "JE-2026-000001")], error: null };
      },
    );

    const result = await postingService.postJournalProposal(buildProposal(), {
      postingDate: ENTRY_DATE,
      nowIso: NOW,
    });

    expect(result.data).toBeNull();
    expect(result.error).toBe("Journal proposal has already been posted.");
  });

  it("propagates a genuine RPC failure", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: { message: "Journal line references an inactive account." },
    });

    const result = await postingService.postJournalProposal(buildProposal(), {
      postingDate: ENTRY_DATE,
      nowIso: NOW,
    });

    expect(result.data).toBeNull();
    expect(result.error).toBe("Journal line references an inactive account.");
  });

  it("enforces append-only ledger behaviour", () => {
    expect(() => postingService.rejectLedgerMutation("update")).toThrow(
      /append-only.*update/i,
    );
    expect(() => postingService.rejectLedgerMutation("delete")).toThrow(
      /append-only.*delete/i,
    );
  });
});
