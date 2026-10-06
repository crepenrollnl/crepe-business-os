import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { requestDriveReceiptSync } = vi.hoisted(() => ({
  requestDriveReceiptSync: vi.fn(),
}));

vi.mock("../utils/purchase-receipt-access-token", () => ({
  getPurchaseReceiptAccessToken: () => Promise.resolve("token"),
}));

vi.mock("../utils/request-drive-receipt-sync", () => ({
  requestDriveReceiptSync: (...args: unknown[]) => requestDriveReceiptSync(...args),
}));

import { useDriveReceiptSync } from "./use-drive-receipt-sync";

describe("useDriveReceiptSync", () => {
  beforeEach(() => {
    requestDriveReceiptSync.mockReset();
  });

  it("does not call the route when the user cannot manage receipts", async () => {
    renderHook(() => useDriveReceiptSync(false));
    await Promise.resolve();
    expect(requestDriveReceiptSync).not.toHaveBeenCalled();
  });

  it("stops when Drive is not configured", async () => {
    requestDriveReceiptSync.mockResolvedValue({ configured: false });
    const { result } = renderHook(() => useDriveReceiptSync(true));
    await waitFor(() => expect(result.current.configured).toBe(false));
    expect(result.current.unavailable).toBe(false);
    expect(requestDriveReceiptSync).toHaveBeenCalledTimes(1);
  });

  it("calls again while pages remain and were copied, and stops at 5 rounds", async () => {
    requestDriveReceiptSync.mockResolvedValue({
      configured: true,
      available: true,
      synced: 1,
      failed: 0,
      remaining: 2,
    });
    renderHook(() => useDriveReceiptSync(true));
    await waitFor(() => expect(requestDriveReceiptSync).toHaveBeenCalledTimes(5));
    await Promise.resolve();
    expect(requestDriveReceiptSync).toHaveBeenCalledTimes(5);
  });

  it("does not keep calling when a round copies nothing", async () => {
    requestDriveReceiptSync.mockResolvedValue({
      configured: true,
      available: true,
      synced: 0,
      failed: 1,
      remaining: 4,
    });
    const { result } = renderHook(() => useDriveReceiptSync(true));
    await waitFor(() => expect(result.current.configured).toBe(true));
    expect(result.current.unavailable).toBe(false);
    expect(requestDriveReceiptSync).toHaveBeenCalledTimes(1);
  });

  it("stops the page load when Drive is unavailable", async () => {
    requestDriveReceiptSync.mockResolvedValue({
      configured: true,
      available: false,
      synced: 1,
      failed: 1,
      remaining: 2,
    });
    const { result } = renderHook(() => useDriveReceiptSync(true));
    await waitFor(() => expect(result.current.unavailable).toBe(true));
    expect(requestDriveReceiptSync).toHaveBeenCalledTimes(1);
  });
});
