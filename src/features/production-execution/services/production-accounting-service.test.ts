/**
 * Production journal posting status (DEV-106).
 *
 * Since sql/149 the database posts production journals; the app only reads
 * whether a posted journal exists for the session's stable business_event_id.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { stableBusinessEventId } from "../utils/stable-business-event-id";

const { supabaseMock } = vi.hoisted(() => ({
  supabaseMock: {
    from: vi.fn(),
    rpc: vi.fn(),
    auth: { getUser: vi.fn() },
  },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: supabaseMock,
}));

import { productionAccountingService } from "./production-accounting-service";

describe("productionAccountingService.getProductionCompletedPostingStatus (DEV-106)", () => {
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

  beforeEach(() => {
    vi.clearAllMocks();
  });

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

  it("looks up the stable id the database trigger posts under (sql/149)", async () => {
    const { eqEvent, eqStatus } = mockJournalLookup({ data: null, error: null });

    await productionAccountingService.getProductionCompletedPostingStatus(
      "session-1",
    );

    expect(eqEvent).toHaveBeenCalledWith(
      "business_event_id",
      stableBusinessEventId("production_completed:session-1"),
    );
    expect(eqStatus).toHaveBeenCalledWith("status", "posted");
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

  it("rejects an empty session id without querying", async () => {
    const result =
      await productionAccountingService.getProductionCompletedPostingStatus("");

    expect(result.data).toBeNull();
    expect(result.error).toBe("Production session id is required.");
    expect(supabaseMock.from).not.toHaveBeenCalled();
  });
});
