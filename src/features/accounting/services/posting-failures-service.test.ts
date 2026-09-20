import { beforeEach, describe, expect, it, vi } from "vitest";

const { supabaseMock } = vi.hoisted(() => ({
  supabaseMock: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: supabaseMock,
}));

import { postingFailuresService } from "./posting-failures-service";

const FAILURE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ENTITY_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function row(overrides?: Record<string, unknown>) {
  return {
    id: FAILURE_ID,
    occurred_at: "2026-09-18T12:00:00.000Z",
    source_flow: "sale_confirm",
    entity_type: "sale",
    entity_id: ENTITY_ID,
    business_event_id: null,
    error_message: "Sale confirmed but accounting posting failed.",
    resolved_at: null,
    resolved_by: null,
    resolution_note: null,
    ...overrides,
  };
}

describe("postingFailuresService.listUnresolved", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads unresolved posting_failures newest first", async () => {
    const orderMock = vi.fn().mockResolvedValue({
      data: [row()],
      error: null,
    });
    const isMock = vi.fn().mockReturnValue({ order: orderMock });
    const selectMock = vi.fn().mockReturnValue({ is: isMock });
    supabaseMock.from.mockReturnValue({ select: selectMock });

    const result = await postingFailuresService.listUnresolved();

    expect(result.error).toBeNull();
    expect(supabaseMock.from).toHaveBeenCalledWith("posting_failures");
    expect(isMock).toHaveBeenCalledWith("resolved_at", null);
    expect(orderMock).toHaveBeenCalledWith("occurred_at", { ascending: false });
    expect(result.data).toEqual([
      {
        id: FAILURE_ID,
        occurredAt: "2026-09-18T12:00:00.000Z",
        sourceFlow: "sale_confirm",
        entityType: "sale",
        entityId: ENTITY_ID,
        businessEventId: null,
        errorMessage: "Sale confirmed but accounting posting failed.",
        resolvedAt: null,
        resolvedBy: null,
        resolutionNote: null,
      },
    ]);
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it("maps a missing-table error", async () => {
    const orderMock = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'relation "posting_failures" does not exist' },
    });
    supabaseMock.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        is: vi.fn().mockReturnValue({ order: orderMock }),
      }),
    });

    const result = await postingFailuresService.listUnresolved();

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "Posting failure log is not available yet. Apply the posting failures database script and try again.",
    );
  });
});

describe("postingFailuresService.resolve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls resolve_posting_failure with an optional note", async () => {
    supabaseMock.rpc.mockResolvedValue({ data: null, error: null });

    const result = await postingFailuresService.resolve(
      FAILURE_ID,
      " Journal posted by hand. ",
    );

    expect(result.error).toBeNull();
    expect(result.data).toEqual({ id: FAILURE_ID });
    expect(supabaseMock.rpc).toHaveBeenCalledWith("resolve_posting_failure", {
      p_id: FAILURE_ID,
      p_resolution_note: "Journal posted by hand.",
    });
    expect(supabaseMock.from).not.toHaveBeenCalled();
  });

  it("rejects an invalid id without calling the RPC", async () => {
    const result = await postingFailuresService.resolve("not-a-uuid");

    expect(result.data).toBeNull();
    expect(result.error).toBe("Posting failure id is required.");
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it("maps already-resolved RPC errors", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: { message: `Posting failure ${FAILURE_ID} is already resolved.` },
    });

    const result = await postingFailuresService.resolve(FAILURE_ID);

    expect(result.data).toBeNull();
    expect(result.error).toBe("This posting failure is already resolved.");
  });
});
