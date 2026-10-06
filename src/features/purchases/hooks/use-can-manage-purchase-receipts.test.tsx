import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getMyRole } = vi.hoisted(() => ({
  getMyRole: vi.fn(),
}));

vi.mock("@/features/auth/services/auth-service", () => ({
  authService: {
    getMyRole: () => getMyRole(),
  },
}));

import { useCanManagePurchaseReceipts } from "./use-can-manage-purchase-receipts";

describe("useCanManagePurchaseReceipts", () => {
  beforeEach(() => {
    getMyRole.mockReset();
  });

  it("stays loading until the role arrives, then allows an owner", async () => {
    let resolveRole: (role: string) => void = () => undefined;
    getMyRole.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveRole = resolve;
        }),
    );

    const { result } = renderHook(() => useCanManagePurchaseReceipts());
    expect(result.current.status).toBe("loading");

    await act(async () => {
      resolveRole("owner");
    });
    await waitFor(() => expect(result.current.status).toBe("allowed"));
  });

  it("denies a seller", async () => {
    getMyRole.mockResolvedValue("seller");
    const { result } = renderHook(() => useCanManagePurchaseReceipts());
    await waitFor(() => expect(result.current.status).toBe("denied"));
  });

  it("reports an error when the lookup fails and retries", async () => {
    getMyRole.mockRejectedValueOnce(new Error("offline")).mockResolvedValue("partner");
    const { result } = renderHook(() => useCanManagePurchaseReceipts());

    await waitFor(() => expect(result.current.status).toBe("error"));

    act(() => {
      result.current.retry();
    });
    await waitFor(() => expect(result.current.status).toBe("allowed"));
  });
});
