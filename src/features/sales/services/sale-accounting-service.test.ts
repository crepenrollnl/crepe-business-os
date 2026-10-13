/**
 * Sale journal posting status (DEV-111).
 *
 * Since sql/147 the database posts sale journals; the app only reads
 * whether a posted journal exists for the sale's stable business_event_ids.
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

import { saleAccountingService } from "./sale-accounting-service";

describe("saleAccountingService.getSaleCompletedPostingStatus (DEV-111)", () => {
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

  beforeEach(() => {
    vi.clearAllMocks();
  });

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

  it("looks up both stable ids the database trigger posts under (sql/147)", async () => {
    const { inEvent, eqStatus } = mockJournalLookup({ data: [], error: null });

    await saleAccountingService.getSaleCompletedPostingStatus("sale-1");

    expect(inEvent).toHaveBeenCalledWith("business_event_id", [
      stableBusinessEventId("sale_completed:sale-1"),
      stableBusinessEventId("cogs_recognized:sale-1"),
    ]);
    expect(eqStatus).toHaveBeenCalledWith("status", "posted");
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

  it("rejects an empty sale id without querying", async () => {
    const result = await saleAccountingService.getSaleCompletedPostingStatus("");

    expect(result.data).toBeNull();
    expect(result.error).toBe("Sale id is required.");
    expect(supabaseMock.from).not.toHaveBeenCalled();
  });
});
