import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PurchaseReceiptCard } from "../types/purchase-receipt";

const { listUnassigned, listRecent, signStoragePaths, save } = vi.hoisted(() => ({
  listUnassigned: vi.fn(),
  listRecent: vi.fn(),
  signStoragePaths: vi.fn(),
  save: vi.fn(),
}));

const { requestDriveReceiptSync } = vi.hoisted(() => ({
  requestDriveReceiptSync: vi.fn(),
}));

vi.mock("../utils/purchase-receipt-access-token", () => ({
  getPurchaseReceiptAccessToken: () => Promise.resolve("token"),
}));

vi.mock("../utils/request-drive-receipt-sync", () => ({
  requestDriveReceiptSync: (...args: unknown[]) => requestDriveReceiptSync(...args),
}));

vi.mock("../services/purchase-receipt-service", () => ({
  purchaseReceiptService: {
    listUnassigned: () => listUnassigned(),
    listRecent: () => listRecent(),
    listActiveSuppliers: () => Promise.resolve({ data: [], error: null }),
    signStoragePaths: (paths: string[]) => signStoragePaths(paths),
    save: (input: unknown) => save(input),
    update: vi.fn(),
    discard: vi.fn(),
    countUnassigned: vi.fn(),
  },
}));

import { usePurchaseReceipts } from "./use-purchase-receipts";

function card(id: string, path: string): PurchaseReceiptCard {
  return {
    id,
    purchaseId: null,
    supplierId: null,
    supplierName: null,
    receiptDate: "2026-10-05",
    receiptTotal: null,
    note: null,
    pageCount: 1,
    pagePaths: [path],
    thumbnailUrl: null,
    files: [],
  };
}

describe("usePurchaseReceipts stale responses", () => {
  beforeEach(() => {
    listUnassigned.mockReset();
    listRecent.mockReset();
    signStoragePaths.mockReset();
    save.mockReset();
    requestDriveReceiptSync.mockReset();
    requestDriveReceiptSync.mockResolvedValue(null);
  });

  it("ignores a late list from the previous view", async () => {
    const unassignedResolvers: Array<
      (value: { data: PurchaseReceiptCard[]; error: null }) => void
    > = [];
    const recentResolvers: Array<
      (value: { data: PurchaseReceiptCard[]; error: null }) => void
    > = [];
    listUnassigned.mockImplementation(
      () =>
        new Promise((resolve) => {
          unassignedResolvers.push(resolve);
        }),
    );
    listRecent.mockImplementation(
      () =>
        new Promise((resolve) => {
          recentResolvers.push(resolve);
        }),
    );

    const { result } = renderHook(() => usePurchaseReceipts(true));
    await waitFor(() => expect(unassignedResolvers).toHaveLength(1));

    act(() => {
      result.current.setView("recent");
    });
    await waitFor(() => expect(recentResolvers).toHaveLength(1));

    await act(async () => {
      unassignedResolvers[0]?.({ data: [card("old", "old.jpg")], error: null });
    });
    expect(result.current.receipts.map((item) => item.id)).not.toContain("old");

    await act(async () => {
      recentResolvers[0]?.({ data: [card("recent", "recent.jpg")], error: null });
    });
    expect(result.current.receipts.map((item) => item.id)).toEqual(["recent"]);
  });

  it("ignores page URLs that arrive for a receipt that is no longer open", async () => {
    const resolvers: Array<(value: { data: string[]; error: null }) => void> = [];
    signStoragePaths.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
    );
    listUnassigned.mockResolvedValue({ data: [], error: null });
    listRecent.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() => usePurchaseReceipts(false));

    await act(async () => {
      void result.current.openReceipt(card("a", "path-a"));
    });
    await act(async () => {
      void result.current.openReceipt(card("b", "path-b"));
    });
    await waitFor(() => expect(resolvers).toHaveLength(2));

    await act(async () => {
      resolvers[0]?.({ data: ["https://signed.example/a"], error: null });
    });
    expect(result.current.selected?.id).toBe("b");
    expect(result.current.pageUrls).toEqual([]);

    await act(async () => {
      resolvers[1]?.({ data: ["https://signed.example/b"], error: null });
    });
    expect(result.current.pageUrls).toEqual(["https://signed.example/b"]);
  });

  it("does not apply a list fetched for a view the user has already left after save", async () => {
    const unassignedResolvers: Array<
      (value: { data: PurchaseReceiptCard[]; error: null }) => void
    > = [];
    const recentResolvers: Array<
      (value: { data: PurchaseReceiptCard[]; error: null }) => void
    > = [];
    listUnassigned.mockImplementation(
      () =>
        new Promise((resolve) => {
          unassignedResolvers.push(resolve);
        }),
    );
    listRecent.mockImplementation(
      () =>
        new Promise((resolve) => {
          recentResolvers.push(resolve);
        }),
    );
    save.mockResolvedValue({ data: "saved-id", error: null });

    const { result } = renderHook(() => usePurchaseReceipts(true));
    await waitFor(() => expect(unassignedResolvers).toHaveLength(1));
    await act(async () => {
      unassignedResolvers[0]?.({ data: [card("old", "old.jpg")], error: null });
    });

    let saveResult: { error: string | null } = { error: "pending" };
    await act(async () => {
      saveResult = await result.current.save({
        receiptDate: "2026-10-05",
        supplierId: null,
        receiptTotal: null,
        note: null,
        pages: [],
      });
    });
    expect(saveResult.error).toBeNull();
    await waitFor(() => expect(unassignedResolvers).toHaveLength(2));

    act(() => {
      result.current.setView("recent");
    });
    await waitFor(() => expect(recentResolvers).toHaveLength(1));

    await act(async () => {
      unassignedResolvers[1]?.({ data: [card("saved", "saved.jpg")], error: null });
    });
    expect(result.current.receipts.map((item) => item.id)).not.toContain("saved");

    await act(async () => {
      recentResolvers[0]?.({ data: [card("recent", "recent.jpg")], error: null });
    });
    expect(result.current.receipts.map((item) => item.id)).toEqual(["recent"]);
  });

  it("does not wait for the drive sync and still succeeds when that call fails", async () => {
    let rejectSync: (reason: unknown) => void = () => undefined;
    requestDriveReceiptSync.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectSync = reject;
        }),
    );
    listUnassigned.mockResolvedValue({ data: [], error: null });
    save.mockResolvedValue({ data: "saved-id", error: null });

    const { result } = renderHook(() => usePurchaseReceipts(true));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let saveResult: { error: string | null } = { error: "pending" };
    await act(async () => {
      saveResult = await result.current.save({
        receiptDate: "2026-10-05",
        supplierId: null,
        receiptTotal: null,
        note: null,
        pages: [],
      });
    });

    expect(saveResult.error).toBeNull();
    expect(requestDriveReceiptSync).toHaveBeenCalledTimes(1);
    await act(async () => {
      rejectSync(new Error("drive sync failed"));
    });
    expect(saveResult.error).toBeNull();
    expect(result.current.error).toBeNull();
  });
});
