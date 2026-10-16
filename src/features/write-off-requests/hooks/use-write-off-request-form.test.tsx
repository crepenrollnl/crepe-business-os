import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { listItemOptionsMock, requestWriteOffMock } = vi.hoisted(() => ({
  listItemOptionsMock: vi.fn(),
  requestWriteOffMock: vi.fn(),
}));

vi.mock("../services/write-off-request-service", () => ({
  writeOffRequestService: {
    listItemOptions: () => listItemOptionsMock(),
    requestWriteOff: (input: unknown) => requestWriteOffMock(input),
  },
}));

import { useWriteOffRequestForm } from "./use-write-off-request-form";

const DISH = { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", name: "Crepe", unit: "pcs" };
const MILK = { id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", name: "Milk", unit: "l" };

async function renderReady(onSubmitted = vi.fn()) {
  const hook = renderHook(() => useWriteOffRequestForm({ onSubmitted }));
  await waitFor(() => expect(hook.result.current.optionsLoading).toBe(false));
  return hook;
}

function fill(result: { current: ReturnType<typeof useWriteOffRequestForm> }) {
  act(() => {
    result.current.updateField("itemId", DISH.id);
    result.current.updateField("quantity", "2");
  });
}

describe("useWriteOffRequestForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listItemOptionsMock.mockResolvedValue({
      data: { dish: [DISH], finished_good: [], ingredient: [MILK] },
      error: null,
    });
  });

  it("filters options by type and search", async () => {
    const { result } = await renderReady();

    expect(result.current.filteredOptions).toEqual([DISH]);
    act(() => {
      result.current.setItemType("ingredient");
    });
    expect(result.current.filteredOptions).toEqual([MILK]);
    act(() => {
      result.current.updateField("search", "zzz");
    });
    expect(result.current.filteredOptions).toEqual([]);
  });

  it("reuses the same client request id when the same attempt is retried", async () => {
    requestWriteOffMock
      .mockResolvedValueOnce({ data: null, error: "Network error." })
      .mockResolvedValueOnce({ data: { id: "r-1", status: "pending" }, error: null });
    const { result } = await renderReady();
    fill(result);

    await act(async () => {
      await result.current.submit();
    });
    expect(result.current.submitError).toBe("Network error.");

    await act(async () => {
      await result.current.submit();
    });

    const first = requestWriteOffMock.mock.calls[0]?.[0] as { client_request_id: string };
    const second = requestWriteOffMock.mock.calls[1]?.[0] as { client_request_id: string };
    expect(first.client_request_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(second.client_request_id).toBe(first.client_request_id);
  });

  it("uses a new client request id after a success, and reports success", async () => {
    requestWriteOffMock.mockResolvedValue({
      data: { id: "r-1", status: "pending" },
      error: null,
    });
    const onSubmitted = vi.fn();
    const { result } = await renderReady(onSubmitted);
    fill(result);

    await act(async () => {
      await result.current.submit();
    });
    expect(result.current.success).toBe("Request sent — waiting for approval");
    expect(onSubmitted).toHaveBeenCalledTimes(1);
    expect(result.current.draft.itemId).toBe("");

    fill(result);
    await act(async () => {
      await result.current.submit();
    });

    const first = requestWriteOffMock.mock.calls[0]?.[0] as { client_request_id: string };
    const second = requestWriteOffMock.mock.calls[1]?.[0] as { client_request_id: string };
    expect(second.client_request_id).not.toBe(first.client_request_id);
    expect(requestWriteOffMock.mock.calls[0]?.[0]).toMatchObject({
      item_type: "dish",
      item_id: DISH.id,
      quantity: 2,
      reason: "spoilage",
      note: null,
    });
  });

  it("does not call the RPC without an item or quantity", async () => {
    const { result } = await renderReady();

    await act(async () => {
      await result.current.submit();
    });

    expect(result.current.submitError).toBe("Choose the item to write off.");
    expect(requestWriteOffMock).not.toHaveBeenCalled();
  });
});
