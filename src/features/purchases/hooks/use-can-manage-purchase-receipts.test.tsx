import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { useRoleMock } = vi.hoisted(() => ({
  useRoleMock: vi.fn(),
}));

vi.mock("@/hooks/use-role", () => ({
  useRole: () => useRoleMock(),
}));

function asRole(role: string | null) {
  useRoleMock.mockReturnValue({ role, loading: false, reload: () => undefined });
}

import { useCanManagePurchaseReceipts } from "./use-can-manage-purchase-receipts";

describe("useCanManagePurchaseReceipts", () => {
  beforeEach(() => {
    useRoleMock.mockReset();
  });

  it("stays loading until the role arrives, then allows an owner", () => {
    useRoleMock.mockReturnValue({ role: null, loading: true, reload: () => undefined });

    const { result, rerender } = renderHook(() => useCanManagePurchaseReceipts());
    expect(result.current.status).toBe("loading");

    asRole("owner");
    rerender();
    expect(result.current.status).toBe("allowed");
  });

  it("denies a seller", () => {
    asRole("seller");
    const { result } = renderHook(() => useCanManagePurchaseReceipts());
    expect(result.current.status).toBe("denied");
  });

  it("reports an error when the role could not be read, and retry reads it again", () => {
    const reload = vi.fn();
    useRoleMock.mockReturnValue({ role: null, loading: false, reload });
    const { result } = renderHook(() => useCanManagePurchaseReceipts());

    expect(result.current.status).toBe("error");

    act(() => {
      result.current.retry();
    });
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
