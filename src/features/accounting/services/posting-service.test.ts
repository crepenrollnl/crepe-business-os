/**
 * Posting Service coverage (DEV-091).
 *
 * Converts Journal Proposals into immutable journal + ledger rows.
 * Only Posting Service may persist ledger_entries.
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
const NOW = "2026-07-26T12:00:00.000Z";
const ENTRY_DATE = "2026-07-26";

interface MockDbState {
  existingPostedByEvent: {
    id: string;
    posting_number: string | null;
    status: string;
  } | null;
  existingById: {
    id: string;
    posting_number: string | null;
    status: string;
  } | null;
  fiscalPeriod: Record<string, unknown> | null;
  accounts: Array<{ id: string; is_active: boolean; is_postable: boolean }>;
  currencies: Array<{ code: string; is_active: boolean }>;
  currencyRate: { id: string; rate: number } | null;
  latestPostingNumber: string | null;
  insertErrors: Partial<Record<string, { message: string }>>;
  updateError: { message: string } | null;
  /** Force verify_journal_posting_amounts' result instead of recomputing it. */
  verifyAmountsOverride?: boolean | { message: string };
}

const inserts: Array<{ table: string; payload: unknown }> = [];
const updates: Array<{ table: string; payload: unknown }> = [];
const deletes: Array<{ table: string }> = [];

function openPeriod(overrides?: Record<string, unknown>) {
  return {
    id: PERIOD_ID,
    name: "2026-Q3",
    start_date: "2026-07-01",
    end_date: "2026-09-30",
    status: "open",
    closed_at: null,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

function buildProposal(
  overrides?: Partial<JournalProposal>,
): JournalProposal {
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

function defaultState(overrides?: Partial<MockDbState>): MockDbState {
  return {
    existingPostedByEvent: null,
    existingById: null,
    fiscalPeriod: openPeriod(),
    accounts: [
      { id: ACCT_DR, is_active: true, is_postable: true },
      { id: ACCT_CR, is_active: true, is_postable: true },
    ],
    currencies: [
      { code: "EUR", is_active: true },
      { code: "USD", is_active: true },
    ],
    currencyRate: { id: "rate-1", rate: 0.92 },
    latestPostingNumber: null,
    insertErrors: {},
    updateError: null,
    ...overrides,
  };
}

function chainable(result: { data: unknown; error: unknown }) {
  const api: Record<string, unknown> = {};
  const self = () => api;
  api.select = vi.fn(self);
  api.insert = vi.fn(async (payload: unknown) => {
    return { data: payload, error: null };
  });
  api.update = vi.fn(self);
  api.delete = vi.fn(self);
  api.eq = vi.fn(self);
  api.in = vi.fn(self);
  api.like = vi.fn(self);
  api.order = vi.fn(self);
  api.limit = vi.fn(self);
  api.maybeSingle = vi.fn(async () => result);
  api.single = vi.fn(async () => result);
  api.then = undefined;
  return api;
}

function installMock(state: MockDbState) {
  inserts.length = 0;
  updates.length = 0;
  deletes.length = 0;

  let journalSelectCount = 0;

  supabaseMock.rpc.mockImplementation(
    async (fn: string, args: Record<string, unknown>) => {
      if (fn === "allocate_posting_number") {
        const entryDate = args.p_entry_date as string;
        const prefix = `JE-${entryDate.slice(0, 4)}-`;
        let nextSeq = 1;
        if (state.latestPostingNumber?.startsWith(prefix)) {
          const parsed = Number.parseInt(
            state.latestPostingNumber.slice(prefix.length),
            10,
          );
          if (Number.isFinite(parsed) && parsed >= 1) {
            nextSeq = parsed + 1;
          }
        }
        return {
          data: `${prefix}${String(nextSeq).padStart(6, "0")}`,
          error: null,
        };
      }
      if (fn === "verify_journal_posting_amounts") {
        if (state.verifyAmountsOverride !== undefined) {
          return typeof state.verifyAmountsOverride === "boolean"
            ? { data: state.verifyAmountsOverride, error: null }
            : { data: null, error: state.verifyAmountsOverride };
        }

        const exchangeRate = args.p_exchange_rate as number;
        const lines = args.p_lines as Array<{
          debit_transaction: number;
          credit_transaction: number;
          debit_base: number;
          credit_base: number;
        }>;

        const round2 = (value: number) => Math.round(value * 100) / 100;

        const linesConsistent = lines.every(
          (line) =>
            round2(line.debit_base) ===
              round2(line.debit_transaction * exchangeRate) &&
            round2(line.credit_base) ===
              round2(line.credit_transaction * exchangeRate),
        );
        const debitTotal = round2(
          lines.reduce((sum, line) => sum + line.debit_base, 0),
        );
        const creditTotal = round2(
          lines.reduce((sum, line) => sum + line.credit_base, 0),
        );

        return {
          data: linesConsistent && debitTotal > 0 && debitTotal === creditTotal,
          error: null,
        };
      }
      return { data: null, error: { message: `Unexpected rpc: ${fn}` } };
    },
  );

  supabaseMock.from.mockImplementation((table: string) => {
    if (table === "journal_entries") {
      const api: Record<string, unknown> = {};

      api.select = vi.fn((columns?: string) => {
        journalSelectCount += 1;
        const selectIndex = journalSelectCount;

        const selectApi: Record<string, unknown> = {};
        const selectSelf = () => selectApi;

        selectApi.eq = vi.fn((col: string) => {
          const eqApi: Record<string, unknown> = {};
          const eqSelf = () => eqApi;

          eqApi.eq = vi.fn(eqSelf);
          eqApi.maybeSingle = vi.fn(async () => {
            if (col === "business_event_id") {
              return {
                data: state.existingPostedByEvent,
                error: null,
              };
            }
            if (col === "id") {
              return { data: state.existingById, error: null };
            }
            return { data: null, error: null };
          });
          eqApi.select = vi.fn(selectSelf);
          eqApi.single = vi.fn(async () => {
            // Final post mark update path uses .update().eq().eq().select().single()
            return {
              data: {
                id: JOURNAL_ID,
                business_event_id: EVENT_ID,
                transaction_id: "txn-1",
                fiscal_period_id: PERIOD_ID,
                entry_date: ENTRY_DATE,
                memo: "Purchase received",
                status: "posted",
                posting_number: "JE-2026-000001",
                transaction_currency: "EUR",
                base_currency: "EUR",
                exchange_rate: 1,
                reversal_of_journal_entry_id: null,
                posted_at: NOW,
                created_at: NOW,
              },
              error: state.updateError,
            };
          });
          return eqApi;
        });

        // Used after update: .update().eq().eq().select().single()
        // When select is called from update chain, columns is the wide select list.
        void columns;
        void selectIndex;
        return selectApi;
      });

      api.insert = vi.fn(async (payload: unknown) => {
        inserts.push({ table, payload });
        return {
          data: payload,
          error: state.insertErrors.journal_entries ?? null,
        };
      });

      api.update = vi.fn((payload: unknown) => {
        updates.push({ table, payload });
        const updateApi: Record<string, unknown> = {};
        const updateSelf = () => updateApi;
        updateApi.eq = vi.fn(updateSelf);
        updateApi.select = vi.fn(() => {
          const selectApi: Record<string, unknown> = {};
          selectApi.single = vi.fn(async () => ({
            data: state.updateError
              ? null
              : {
                  id: JOURNAL_ID,
                  business_event_id: EVENT_ID,
                  transaction_id: "txn-1",
                  fiscal_period_id: PERIOD_ID,
                  entry_date: ENTRY_DATE,
                  memo: "Purchase received",
                  status: "posted",
                  posting_number: (payload as { posting_number: string })
                    .posting_number,
                  transaction_currency:
                    (payload as { transaction_currency?: string })
                      .transaction_currency ?? "EUR",
                  base_currency: "EUR",
                  exchange_rate: 1,
                  reversal_of_journal_entry_id: null,
                  posted_at: NOW,
                  created_at: NOW,
                },
            error: state.updateError,
          }));
          return selectApi;
        });
        return updateApi;
      });

      api.delete = vi.fn(async () => {
        deletes.push({ table });
        return { data: null, error: null };
      });

      return api;
    }

    if (table === "fiscal_periods") {
      const api = chainable({ data: state.fiscalPeriod, error: null });
      api.select = vi.fn(() => {
        const selectApi: Record<string, unknown> = {};
        selectApi.eq = vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({
            data: state.fiscalPeriod,
            error: null,
          })),
        }));
        return selectApi;
      });
      return api;
    }

    if (table === "accounts") {
      return {
        select: vi.fn(() => ({
          in: vi.fn(async () => ({
            data: state.accounts,
            error: null,
          })),
        })),
        insert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      };
    }

    if (table === "currencies") {
      return {
        select: vi.fn(() => ({
          in: vi.fn(async () => ({
            data: state.currencies,
            error: null,
          })),
        })),
        insert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      };
    }

    if (table === "currency_rates") {
      const api: Record<string, unknown> = {};
      const self = () => api;
      api.select = vi.fn(self);
      api.eq = vi.fn(self);
      api.limit = vi.fn(self);
      api.maybeSingle = vi.fn(async () => ({
        data: state.currencyRate,
        error: null,
      }));
      return api;
    }

    if (table === "journal_lines") {
      return {
        select: vi.fn(),
        insert: vi.fn(async (payload: unknown) => {
          inserts.push({ table, payload });
          return {
            data: payload,
            error: state.insertErrors.journal_lines ?? null,
          };
        }),
        update: vi.fn((payload: unknown) => {
          updates.push({ table, payload });
          return { eq: vi.fn() };
        }),
        delete: vi.fn(async () => {
          deletes.push({ table });
          return { data: null, error: null };
        }),
      };
    }

    if (table === "ledger_entries") {
      return {
        select: vi.fn(),
        insert: vi.fn(async (payload: unknown) => {
          inserts.push({ table, payload });
          return {
            data: payload,
            error: state.insertErrors.ledger_entries ?? null,
          };
        }),
        update: vi.fn((payload: unknown) => {
          updates.push({ table, payload });
          return {
            eq: vi.fn(async () => ({ data: null, error: null })),
          };
        }),
        delete: vi.fn(async () => {
          deletes.push({ table });
          return { data: null, error: null };
        }),
      };
    }

    throw new Error(`Unexpected table: ${table}`);
  });
}

describe("postingService (DEV-091)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    inserts.length = 0;
    updates.length = 0;
    deletes.length = 0;
  });

  it("posts a balanced journal proposal successfully", async () => {
    installMock(defaultState());

    const result = await postingService.postJournalProposal(buildProposal(), {
      postingDate: ENTRY_DATE,
      nowIso: NOW,
    });

    expect(result.error).toBeNull();
    expect(result.data?.posting_number).toBe("JE-2026-000001");
    expect(result.data?.posting_date).toBe(ENTRY_DATE);
    expect(result.data?.fiscal_period_id).toBe(PERIOD_ID);
    expect(result.data?.journal_entry.status).toBe("posted");
    expect(result.data?.journal_entry.posting_number).toBe("JE-2026-000001");
    expect(result.data?.journal_lines).toHaveLength(2);
    expect(result.data?.ledger_entries).toHaveLength(2);

    const journalInsert = inserts.find((row) => row.table === "journal_entries");
    expect(journalInsert?.payload).toMatchObject({
      id: JOURNAL_ID,
      status: "draft",
      posting_number: null,
      entry_date: ENTRY_DATE,
    });

    expect(inserts.some((row) => row.table === "journal_lines")).toBe(true);
    expect(inserts.some((row) => row.table === "ledger_entries")).toBe(true);

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      table: "journal_entries",
      payload: {
        status: "posted",
        posting_number: "JE-2026-000001",
        posted_at: NOW,
        entry_date: ENTRY_DATE,
      },
    });

    // Append-only: never update/delete ledger through posting success path.
    expect(updates.some((row) => row.table === "ledger_entries")).toBe(false);
    expect(deletes.some((row) => row.table === "ledger_entries")).toBe(false);
  });

  it("prevents duplicate posting for the same business event", async () => {
    installMock(
      defaultState({
        existingPostedByEvent: {
          id: JOURNAL_ID,
          posting_number: "JE-2026-000001",
          status: "posted",
        },
      }),
    );

    const result = await postingService.postJournalProposal(buildProposal(), {
      postingDate: ENTRY_DATE,
      nowIso: NOW,
    });

    expect(result.data).toBeNull();
    expect(result.error).toBe("Journal proposal has already been posted.");
    expect(inserts).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  it("rejects a proposal that fails server-side amount verification (V1 plan 1.7)", async () => {
    installMock(defaultState({ verifyAmountsOverride: false }));

    const result = await postingService.postJournalProposal(buildProposal(), {
      postingDate: ENTRY_DATE,
      nowIso: NOW,
    });

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "Journal proposal failed server-side amount verification and was not posted.",
    );
    expect(inserts).toHaveLength(0);
  });

  it("surfaces an error from the amount verification RPC itself", async () => {
    installMock(
      defaultState({
        verifyAmountsOverride: { message: "connection reset" },
      }),
    );

    const result = await postingService.postJournalProposal(buildProposal(), {
      postingDate: ENTRY_DATE,
      nowIso: NOW,
    });

    expect(result.data).toBeNull();
    expect(result.error).toBe("connection reset");
    expect(inserts).toHaveLength(0);
  });

  it("rejects posting into a closed fiscal period", async () => {
    installMock(
      defaultState({
        fiscalPeriod: openPeriod({
          status: "closed",
          closed_at: "2026-07-20T00:00:00.000Z",
        }),
      }),
    );

    const result = await postingService.postJournalProposal(buildProposal(), {
      postingDate: ENTRY_DATE,
      nowIso: NOW,
    });

    expect(result.data).toBeNull();
    expect(result.error).toBe("Fiscal period is not open for posting.");
    expect(inserts).toHaveLength(0);
  });

  it("rejects inactive accounts", async () => {
    installMock(
      defaultState({
        accounts: [
          { id: ACCT_DR, is_active: false, is_postable: true },
          { id: ACCT_CR, is_active: true, is_postable: true },
        ],
      }),
    );

    const result = await postingService.postJournalProposal(buildProposal(), {
      postingDate: ENTRY_DATE,
      nowIso: NOW,
    });

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "Journal line references an inactive account.",
    );
    expect(inserts).toHaveLength(0);
  });

  it("rejects missing exchange rate for multi-currency journals", async () => {
    installMock(
      defaultState({
        currencyRate: null,
      }),
    );

    const base = buildProposal();
    const proposal = buildProposal({
      journal_entry: {
        ...base.journal_entry,
        transaction_currency: "USD",
        base_currency: "EUR",
        exchange_rate: 0.92,
      },
      // Base amounts converted at 0.92 so this fixture is internally
      // consistent and only fails at the exchange-rate-availability check
      // this test targets, not the server-side amount verification (1.7).
      journal_lines: base.journal_lines.map((line) => ({
        ...line,
        debit_base: Math.round(line.debit_transaction * 0.92 * 100) / 100,
        credit_base: Math.round(line.credit_transaction * 0.92 * 100) / 100,
      })),
      ledger_entries: base.ledger_entries.map((entry) => ({
        ...entry,
        transaction_currency: "USD",
        base_currency: "EUR",
        debit_base: Math.round(entry.debit_transaction * 0.92 * 100) / 100,
        credit_base: Math.round(entry.credit_transaction * 0.92 * 100) / 100,
      })),
    });

    const result = await postingService.postJournalProposal(proposal, {
      postingDate: ENTRY_DATE,
      nowIso: NOW,
    });

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "No exchange rate is available for the posting date.",
    );
    expect(inserts).toHaveLength(0);
  });

  it("enforces append-only ledger behaviour", () => {
    expect(() => postingService.rejectLedgerMutation("update")).toThrow(
      /append-only.*update/i,
    );
    expect(() => postingService.rejectLedgerMutation("delete")).toThrow(
      /append-only.*delete/i,
    );
  });

  it("increments posting numbers within the year", async () => {
    installMock(
      defaultState({
        latestPostingNumber: "JE-2026-000042",
      }),
    );

    const result = await postingService.postJournalProposal(buildProposal(), {
      postingDate: ENTRY_DATE,
      nowIso: NOW,
    });

    expect(result.error).toBeNull();
    expect(result.data?.posting_number).toBe("JE-2026-000043");
    expect(updates[0]?.payload).toMatchObject({
      posting_number: "JE-2026-000043",
    });
  });
});
