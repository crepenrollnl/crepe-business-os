/**
 * Hook coverage for useProductionSession's finishProduction (DEV-105 wiring).
 *
 * completeSession has already succeeded and is durable by the time posting
 * is attempted — a posting/context failure must never look like the whole
 * finish action failed. The session must still apply; postingError is the
 * only signal that the accounting entry was skipped or failed.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProductionSessionWithRelations } from "../types/production-session";

const {
  getSessionByIdMock,
  completeSessionMock,
  completeSessionAndPostJournalMock,
  getCurrentAccountingContextMock,
} = vi.hoisted(() => ({
  getSessionByIdMock: vi.fn(),
  completeSessionMock: vi.fn(),
  completeSessionAndPostJournalMock: vi.fn(),
  getCurrentAccountingContextMock: vi.fn(),
}));

vi.mock("../services/production-session-service", () => ({
  productionSessionService: {
    getSessionById: (...args: unknown[]) => getSessionByIdMock(...args),
    completeSession: (...args: unknown[]) => completeSessionMock(...args),
    completeSessionAndPostJournal: (...args: unknown[]) =>
      completeSessionAndPostJournalMock(...args),
  },
}));

vi.mock("@/features/accounting/services/accounting-context-service", () => ({
  accountingContextService: {
    getCurrentAccountingContext: (...args: unknown[]) =>
      getCurrentAccountingContextMock(...args),
  },
}));

import { useProductionSession } from "./use-production-session";

const SESSION_ID = "session-1";
const ACCOUNTING_CONTEXT = {
  fiscalPeriod: {
    id: "period-1",
    name: "FY2026",
    start_date: "2026-01-01",
    end_date: "2026-12-31",
    status: "open",
    closed_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
  },
  accountRoleBindings: [],
  baseCurrency: "EUR",
  transactionCurrency: "EUR",
  exchangeRate: 1,
  rateDate: "2026-08-03",
};

function sessionFixture(
  overrides?: Partial<ProductionSessionWithRelations>,
): ProductionSessionWithRelations {
  return {
    id: SESSION_ID,
    session_number: 1,
    production_plan_id: "plan-1",
    status: "in_progress",
    started_at: "2026-08-03T08:00:00.000Z",
    completed_at: null,
    completed_by: null,
    operator_name: null,
    notes: null,
    created_at: "2026-08-03T08:00:00.000Z",
    lines: [
      {
        id: "line-1",
        production_session_id: SESSION_ID,
        production_plan_product_id: "plan-product-1",
        recipe_id: "recipe-1",
        product_name: "Chicken Crepe",
        planned_quantity: 10,
        actual_produced_quantity: 10,
        raw_material_scale: null,
        yield_unit: "pcs",
        sort_order: 1,
        difference: 0,
      },
    ],
    plan: { id: "plan-1", plan_number: 1, name: "Test Plan" },
    ...overrides,
  };
}

function completedFixture(): ProductionSessionWithRelations {
  return sessionFixture({
    status: "completed",
    completed_at: "2026-08-03T09:00:00.000Z",
    batches: [],
  });
}

describe("useProductionSession.finishProduction (accounting posting wiring)", () => {
  beforeEach(() => {
    getSessionByIdMock.mockReset();
    completeSessionMock.mockReset();
    completeSessionAndPostJournalMock.mockReset();
    getCurrentAccountingContextMock.mockReset();

    getSessionByIdMock.mockResolvedValue({ data: sessionFixture(), error: null });
  });

  it("applies the completed session and clears postingError when posting succeeds", async () => {
    getCurrentAccountingContextMock.mockResolvedValue({
      data: ACCOUNTING_CONTEXT,
      error: null,
    });
    completeSessionAndPostJournalMock.mockResolvedValue({
      data: {
        session: completedFixture(),
        posting: { source_document_id: "s1", event_type: "production_completed", postingResult: {}, batch_ids: [] },
        postingError: null,
      },
      error: null,
    });
    // Post-posting reload picks up the fresh accounting_posting_status.
    getSessionByIdMock.mockResolvedValueOnce({ data: sessionFixture(), error: null });
    getSessionByIdMock.mockResolvedValueOnce({
      data: { ...completedFixture(), accounting_posting_status: "posted" },
      error: null,
    });

    const { result } = renderHook(() => useProductionSession(SESSION_ID));

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.finishProduction();
    });

    expect(completeSessionAndPostJournalMock).toHaveBeenCalledTimes(1);
    expect(completeSessionMock).not.toHaveBeenCalled();
    expect(result.current.session?.status).toBe("completed");
    expect(result.current.session?.accounting_posting_status).toBe("posted");
    expect(result.current.postingError).toBeNull();
    expect(result.current.actionError).toBeNull();
    expect(result.current.finishing).toBe(false);
  });

  it("still applies the completed session when posting itself fails, and surfaces postingError", async () => {
    getCurrentAccountingContextMock.mockResolvedValue({
      data: ACCOUNTING_CONTEXT,
      error: null,
    });
    completeSessionAndPostJournalMock.mockResolvedValue({
      data: {
        session: completedFixture(),
        posting: null,
        postingError: "Production completed but accounting posting failed.",
      },
      error: null,
    });
    getSessionByIdMock.mockResolvedValueOnce({ data: sessionFixture(), error: null });
    getSessionByIdMock.mockResolvedValueOnce({ data: completedFixture(), error: null });

    const { result } = renderHook(() => useProductionSession(SESSION_ID));

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.finishProduction();
    });

    expect(result.current.session?.status).toBe("completed");
    expect(result.current.postingError).toBe(
      "Production completed but accounting posting failed.",
    );
    expect(result.current.actionError).toBeNull();
  });

  it("falls back to plain completeSession and still applies the session when the accounting context cannot be built", async () => {
    getCurrentAccountingContextMock.mockResolvedValue({
      data: null,
      error: "No open fiscal period covers today's date.",
    });
    completeSessionMock.mockResolvedValue({
      data: completedFixture(),
      error: null,
    });
    getSessionByIdMock.mockResolvedValueOnce({ data: sessionFixture(), error: null });

    const { result } = renderHook(() => useProductionSession(SESSION_ID));

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.finishProduction();
    });

    expect(completeSessionMock).toHaveBeenCalledTimes(1);
    expect(completeSessionAndPostJournalMock).not.toHaveBeenCalled();
    expect(result.current.session?.status).toBe("completed");
    expect(result.current.postingError).toBe(
      "No open fiscal period covers today's date.",
    );
    expect(result.current.actionError).toBeNull();
  });

  it("does not apply any session and surfaces actionError when completeSession itself fails", async () => {
    getCurrentAccountingContextMock.mockResolvedValue({
      data: ACCOUNTING_CONTEXT,
      error: null,
    });
    completeSessionAndPostJournalMock.mockResolvedValue({
      data: null,
      error: "Insufficient stock for Chicken Crepe.",
    });
    getSessionByIdMock.mockResolvedValueOnce({ data: sessionFixture(), error: null });

    const { result } = renderHook(() => useProductionSession(SESSION_ID));

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.finishProduction();
    });

    expect(result.current.session?.status).toBe("in_progress");
    expect(result.current.actionError).toBe("Insufficient stock for Chicken Crepe.");
    expect(result.current.postingError).toBeNull();
  });
});
