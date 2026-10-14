/**
 * Purchase journal posting status.
 *
 * Since sql/150 the database posts purchase journals; the app only reads
 * whether a posted journal exists for the purchase's stable business_event_id.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { stableBusinessEventId } from "../utils/stable-business-event-id";

const { supabaseMock } = vi.hoisted(() => ({
  supabaseMock: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: supabaseMock,
}));

import { purchasePostingStatusService } from "./purchase-posting-status-service";

const PURCHASE_ID = "00000000-0000-4000-8000-000000000001";

describe("purchasePostingStatusService.getPurchaseReceivedPostingStatus (sql/150)", () => {
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

  it("returns posted when a posted journal exists for the purchase", async () => {
    mockJournalLookup({ data: { id: "je-1", status: "posted" }, error: null });

    const result =
      await purchasePostingStatusService.getPurchaseReceivedPostingStatus(PURCHASE_ID);

    expect(result.error).toBeNull();
    expect(result.data).toBe("posted");
    expect(supabaseMock.from).toHaveBeenCalledWith("journal_entries");
  });

  it("looks up the stable id the database posts under (sql/150 vector)", async () => {
    const { eqEvent, eqStatus } = mockJournalLookup({ data: null, error: null });

    await purchasePostingStatusService.getPurchaseReceivedPostingStatus(PURCHASE_ID);

    expect(eqEvent).toHaveBeenCalledWith(
      "business_event_id",
      stableBusinessEventId(`purchase_received:${PURCHASE_ID}`),
    );
    // Same value tests/sql/purchase_auto_posting.sql pins for this id.
    expect(eqEvent).toHaveBeenCalledWith(
      "business_event_id",
      "9c483a98-95eb-5198-906f-c92fc7da8ede",
    );
    expect(eqStatus).toHaveBeenCalledWith("status", "posted");
  });

  it("returns pending when no posted journal exists", async () => {
    mockJournalLookup({ data: null, error: null });

    const result =
      await purchasePostingStatusService.getPurchaseReceivedPostingStatus(PURCHASE_ID);

    expect(result.error).toBeNull();
    expect(result.data).toBe("pending");
  });

  it("returns pending when the journal_entries table is unavailable", async () => {
    mockJournalLookup({
      data: null,
      error: { message: "relation journal_entries does not exist" },
    });

    const result =
      await purchasePostingStatusService.getPurchaseReceivedPostingStatus(PURCHASE_ID);

    expect(result.error).toBeNull();
    expect(result.data).toBe("pending");
  });

  it("fails on other read errors", async () => {
    mockJournalLookup({ data: null, error: { message: "Statement timeout." } });

    const result =
      await purchasePostingStatusService.getPurchaseReceivedPostingStatus(PURCHASE_ID);

    expect(result.data).toBeNull();
    expect(result.error).toBeTruthy();
  });

  it("rejects an empty purchase id without querying", async () => {
    const result =
      await purchasePostingStatusService.getPurchaseReceivedPostingStatus("  ");

    expect(result.data).toBeNull();
    expect(result.error).toBe("Purchase id is required.");
    expect(supabaseMock.from).not.toHaveBeenCalled();
  });
});
