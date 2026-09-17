/**
 * Hook coverage for useSales' createDraft() client_request_id idempotency
 * token (sql/118, audit finding #9) -- the standalone /sales "New" button
 * path, independent of the POS one-tap flow.
 *
 * One token per "New" click, reused across a failed retry of that same
 * click, cleared after a successful draft creation so the next click gets
 * a fresh token.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { listSalesMock, createDraftSaleMock } = vi.hoisted(() => ({
  listSalesMock: vi.fn(),
  createDraftSaleMock: vi.fn(),
}));

vi.mock("../services/sales-read-service", () => ({
  salesReadService: {
    listSales: (...args: unknown[]) => listSalesMock(...args),
  },
}));

vi.mock("../services/sales-service", () => ({
  salesService: {
    createDraftSale: (...args: unknown[]) => createDraftSaleMock(...args),
  },
}));

import { useSales } from "./use-sales";

describe("useSales.createDraft client_request_id (sql/118)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listSalesMock.mockResolvedValue({ data: [], error: null });
  });

  it("generates a token and passes it to createDraftSale", async () => {
    createDraftSaleMock.mockResolvedValueOnce({
      data: { saleId: "sale-1" },
      error: null,
    });

    const { result } = renderHook(() => useSales());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.createDraft();
    });

    expect(createDraftSaleMock).toHaveBeenCalledTimes(1);
    const token = createDraftSaleMock.mock.calls[0][0]
      .client_request_id as string;
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);
  });

  it("reuses the same token across a failed retry", async () => {
    createDraftSaleMock.mockResolvedValueOnce({
      data: null,
      error: "Failed to create draft sale",
    });

    const { result } = renderHook(() => useSales());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.createDraft();
    });

    const firstToken = createDraftSaleMock.mock.calls[0][0]
      .client_request_id as string;

    createDraftSaleMock.mockResolvedValueOnce({
      data: { saleId: "sale-1" },
      error: null,
    });

    await act(async () => {
      await result.current.createDraft();
    });

    const secondToken = createDraftSaleMock.mock.calls[1][0]
      .client_request_id as string;

    expect(secondToken).toBe(firstToken);
  });

  it("uses a fresh token for the next click after a success", async () => {
    createDraftSaleMock.mockResolvedValueOnce({
      data: { saleId: "sale-1" },
      error: null,
    });

    const { result } = renderHook(() => useSales());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.createDraft();
    });

    const firstToken = createDraftSaleMock.mock.calls[0][0]
      .client_request_id as string;

    createDraftSaleMock.mockResolvedValueOnce({
      data: { saleId: "sale-2" },
      error: null,
    });

    await act(async () => {
      await result.current.createDraft();
    });

    const secondToken = createDraftSaleMock.mock.calls[1][0]
      .client_request_id as string;

    expect(secondToken).not.toBe(firstToken);
  });
});
