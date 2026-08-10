/**
 * Service-level coverage for completeSessionAndPostJournal (DEV-105).
 *
 * completeSession has already succeeded and is durable by the time posting
 * is attempted — a posting failure must never look like the whole finish
 * action failed (that would silently discard a real completed production
 * session). Spies on completeSession directly (its own internals are
 * covered separately) so this file can focus purely on the ok()/fail()
 * contract completeSessionAndPostJournal adds around it.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { postJournalForProductionCompletedMock } = vi.hoisted(() => ({
  postJournalForProductionCompletedMock: vi.fn(),
}));

// Not exercised directly (completeSession is spied on below) — only needed
// so importing production-session-service.ts doesn't construct a real
// Supabase client at module load time.
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
    auth: { getUser: vi.fn() },
  },
}));

vi.mock("./production-accounting-service", () => ({
  productionAccountingService: {
    postJournalForProductionCompleted: (...args: unknown[]) =>
      postJournalForProductionCompletedMock(...args),
  },
}));

import { productionSessionService } from "./production-session-service";
import type { ProductionSessionWithRelations } from "../types/production-session";
import type { ProductionBatchWithProduct } from "../types/production-batch";

const SESSION_ID = "session-1";

const ACCOUNTING_CONTEXT = {
  fiscalPeriod: {
    id: "period-1",
    name: "FY2026",
    start_date: "2026-01-01",
    end_date: "2026-12-31",
    status: "open" as const,
    closed_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
  },
  accountRoleBindings: [],
  baseCurrency: "EUR",
  transactionCurrency: "EUR",
  exchangeRate: 1,
  rateDate: "2026-08-03",
};

function completedSession(): ProductionSessionWithRelations {
  return {
    id: SESSION_ID,
    session_number: 1,
    production_plan_id: "plan-1",
    status: "completed",
    started_at: "2026-08-03T08:00:00.000Z",
    completed_at: "2026-08-03T09:00:00.000Z",
    completed_by: "user-1",
    operator_name: null,
    notes: null,
    created_at: "2026-08-03T08:00:00.000Z",
    lines: [],
    plan: { id: "plan-1", plan_number: 1, name: "Test Plan" },
    batches: [
      {
        id: "batch-1",
        produced_quantity: 10,
        unit_cost: 2,
        total_cost: 20,
      } as unknown as ProductionBatchWithProduct,
    ],
  };
}

describe("productionSessionService.completeSessionAndPostJournal (DEV-105)", () => {
  beforeEach(() => {
    postJournalForProductionCompletedMock.mockReset();
  });

  it("returns ok() with the posted journal when completion and posting both succeed", async () => {
    const completeSessionSpy = vi
      .spyOn(productionSessionService, "completeSession")
      .mockResolvedValue({ data: completedSession(), error: null });

    postJournalForProductionCompletedMock.mockResolvedValue({
      data: {
        source_document_id: SESSION_ID,
        event_type: "production_completed",
        postingResult: { status: "posted" },
        batch_ids: ["batch-1"],
      },
      error: null,
    });

    const result = await productionSessionService.completeSessionAndPostJournal(
      SESSION_ID,
      { notes: null, lines: [] },
      ACCOUNTING_CONTEXT,
    );

    expect(result.error).toBeNull();
    expect(result.data?.session.status).toBe("completed");
    expect(result.data?.posting).not.toBeNull();
    expect(result.data?.postingError).toBeNull();

    completeSessionSpy.mockRestore();
  });

  it("still returns ok() with the completed session when posting fails — never discards a successful completion", async () => {
    const completeSessionSpy = vi
      .spyOn(productionSessionService, "completeSession")
      .mockResolvedValue({ data: completedSession(), error: null });

    postJournalForProductionCompletedMock.mockResolvedValue({
      data: null,
      error: "No open fiscal period covers today's date.",
    });

    const result = await productionSessionService.completeSessionAndPostJournal(
      SESSION_ID,
      { notes: null, lines: [] },
      ACCOUNTING_CONTEXT,
    );

    expect(result.error).toBeNull();
    expect(result.data?.session.status).toBe("completed");
    expect(result.data?.session.id).toBe(SESSION_ID);
    expect(result.data?.posting).toBeNull();
    expect(result.data?.postingError).toBe(
      "No open fiscal period covers today's date.",
    );

    completeSessionSpy.mockRestore();
  });

  it("returns fail() and never calls posting when completeSession itself fails", async () => {
    const completeSessionSpy = vi
      .spyOn(productionSessionService, "completeSession")
      .mockResolvedValue({ data: null, error: "Insufficient stock." });

    const result = await productionSessionService.completeSessionAndPostJournal(
      SESSION_ID,
      { notes: null, lines: [] },
      ACCOUNTING_CONTEXT,
    );

    expect(result.data).toBeNull();
    expect(result.error).toBe("Insufficient stock.");
    expect(postJournalForProductionCompletedMock).not.toHaveBeenCalled();

    completeSessionSpy.mockRestore();
  });
});
