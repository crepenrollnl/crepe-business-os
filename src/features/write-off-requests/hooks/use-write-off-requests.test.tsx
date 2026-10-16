import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WriteOffRequest } from "../types/write-off-request";
import { WRITE_OFF_REQUESTS_CHANGED_EVENT } from "../utils/write-off-request-events";

const { listRequestsMock, approveMock, rejectMock } = vi.hoisted(() => ({
  listRequestsMock: vi.fn(),
  approveMock: vi.fn(),
  rejectMock: vi.fn(),
}));

vi.mock("../services/write-off-request-service", () => ({
  writeOffRequestService: {
    listRequests: () => listRequestsMock(),
    approve: (id: string, quantity: number | null) => approveMock(id, quantity),
    reject: (id: string, note: string | null) => rejectMock(id, note),
  },
}));

import { useWriteOffRequests } from "./use-write-off-requests";

function request(id: string, status: WriteOffRequest["status"], isMine = false): WriteOffRequest {
  return {
    id,
    item_type: "ingredient",
    ingredient_id: "i-1",
    product_id: null,
    item_name: "Milk",
    unit: "l",
    quantity: 2,
    approved_quantity: null,
    reason: "spoilage",
    note: null,
    status,
    requested_by: "u-1",
    requested_at: "2026-10-15T10:00:00.000Z",
    decided_by: null,
    decided_at: null,
    decision_note: null,
    is_mine: isMine,
  };
}

describe("useWriteOffRequests", () => {
  const onChanged = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    window.addEventListener(WRITE_OFF_REQUESTS_CHANGED_EVENT, onChanged);
    listRequestsMock.mockResolvedValue({
      data: [request("a", "pending"), request("b", "approved", true), request("c", "rejected")],
      error: null,
    });
  });

  afterEach(() => {
    window.removeEventListener(WRITE_OFF_REQUESTS_CHANGED_EVENT, onChanged);
  });

  it("splits pending, decided and mine", async () => {
    const { result } = renderHook(() => useWriteOffRequests());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.pending.map((item) => item.id)).toEqual(["a"]);
    expect(result.current.decided.map((item) => item.id)).toEqual(["b", "c"]);
    expect(result.current.mine.map((item) => item.id)).toEqual(["b"]);
  });

  it("keeps the row and shows the server error when approval fails", async () => {
    approveMock.mockResolvedValue({
      data: null,
      error: "Insufficient ingredient stock for this write-off.",
    });
    const { result } = renderHook(() => useWriteOffRequests());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.approve("a", 1.5);
    });

    expect(ok).toBe(false);
    expect(approveMock).toHaveBeenCalledWith("a", 1.5);
    expect(result.current.rowErrors.a).toBe(
      "Insufficient ingredient stock for this write-off.",
    );
    expect(result.current.pending.map((item) => item.id)).toEqual(["a"]);
    expect(listRequestsMock).toHaveBeenCalledTimes(1);
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("refreshes the list and tells the menu counter after a decision", async () => {
    rejectMock.mockResolvedValue({ data: { id: "a", status: "rejected" }, error: null });
    const { result } = renderHook(() => useWriteOffRequests());
    await waitFor(() => expect(result.current.loading).toBe(false));
    listRequestsMock.mockResolvedValue({
      data: [request("a", "rejected"), request("b", "approved", true)],
      error: null,
    });

    await act(async () => {
      await result.current.reject("a", "Not spoiled");
    });

    expect(rejectMock).toHaveBeenCalledWith("a", "Not spoiled");
    expect(listRequestsMock).toHaveBeenCalledTimes(2);
    expect(result.current.pending).toEqual([]);
    expect(result.current.notice).toBe("Request rejected.");
    expect(onChanged).toHaveBeenCalledTimes(1);
  });
});
