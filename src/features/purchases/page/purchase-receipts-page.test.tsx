import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const { getMyRoleMock, usePurchaseReceiptsMock, getPurchaseReceiptAccessToken, requestDriveReceiptSync } =
  vi.hoisted(() => ({
    getMyRoleMock: vi.fn(),
    usePurchaseReceiptsMock: vi.fn(),
    getPurchaseReceiptAccessToken: vi.fn(),
    requestDriveReceiptSync: vi.fn(),
  }));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@/features/auth/services/auth-service", () => ({
  authService: {
    getMyRole: () => getMyRoleMock(),
  },
}));

vi.mock("../utils/purchase-receipt-access-token", () => ({
  getPurchaseReceiptAccessToken: () => getPurchaseReceiptAccessToken(),
}));

vi.mock("../utils/request-drive-receipt-sync", () => ({
  requestDriveReceiptSync: (...args: unknown[]) => requestDriveReceiptSync(...args),
}));

vi.mock("../hooks/use-purchase-receipts", () => ({
  usePurchaseReceipts: (enabled: boolean) => usePurchaseReceiptsMock(enabled),
}));

import { PurchaseReceiptsPage } from "./purchase-receipts-page";

const idle = {
  view: "unassigned" as const,
  setView: vi.fn(),
  receipts: [],
  suppliers: [],
  loading: false,
  error: null,
  isSaving: false,
  photosLoading: false,
  selected: null,
  pageUrls: [],
  viewerError: null,
  retry: vi.fn(),
  save: vi.fn(),
  openReceipt: vi.fn(),
  closeReceipt: vi.fn(),
  updateReceipt: vi.fn(),
  discardReceipt: vi.fn(),
};

describe("PurchaseReceiptsPage role gate", () => {
  afterEach(() => {
    cleanup();
    getMyRoleMock.mockReset();
    usePurchaseReceiptsMock.mockReset();
    getPurchaseReceiptAccessToken.mockReset();
    getPurchaseReceiptAccessToken.mockResolvedValue(null);
    requestDriveReceiptSync.mockReset();
    requestDriveReceiptSync.mockResolvedValue(null);
  });

  it("does not show the receipt screen to a seller", async () => {
    getMyRoleMock.mockResolvedValue("seller");
    usePurchaseReceiptsMock.mockReturnValue(idle);

    render(<PurchaseReceiptsPage />);

    await waitFor(() => {
      expect(usePurchaseReceiptsMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    expect(usePurchaseReceiptsMock.mock.calls.every(([enabled]) => enabled === false)).toBe(true);
    expect(
      screen.getByText("Receipts are available to the owner and partner only."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to purchases" })).toBeInTheDocument();
    expect(screen.queryByText("Take photo")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Unassigned" })).not.toBeInTheDocument();
    expect(getPurchaseReceiptAccessToken).not.toHaveBeenCalled();
  });

  it("shows a loading line and does not open the form while the role is loading", () => {
    getMyRoleMock.mockImplementation(() => new Promise(() => undefined));
    usePurchaseReceiptsMock.mockReturnValue(idle);

    render(<PurchaseReceiptsPage />);

    expect(screen.getByText("Loading receipts.")).toBeInTheDocument();
    expect(usePurchaseReceiptsMock).toHaveBeenCalledWith(false);
    expect(screen.queryByText("Take photo")).not.toBeInTheDocument();
  });

  it("shows an error and retry, then the form after access succeeds", async () => {
    getMyRoleMock
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue("owner");
    usePurchaseReceiptsMock.mockReturnValue(idle);

    render(<PurchaseReceiptsPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not check your access.");
    expect(usePurchaseReceiptsMock).not.toHaveBeenCalledWith(true);

    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("Take photo")).toBeInTheDocument();
    expect(usePurchaseReceiptsMock).toHaveBeenCalledWith(true);
  });

  it("shows the receipt screen to an owner", async () => {
    getMyRoleMock.mockResolvedValue("owner");
    usePurchaseReceiptsMock.mockReturnValue(idle);

    render(<PurchaseReceiptsPage />);

    await waitFor(() => {
      expect(usePurchaseReceiptsMock).toHaveBeenCalledWith(true);
    });
    expect(screen.getByText("Take photo")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unassigned" })).toBeInTheDocument();
    expect(
      screen.queryByText(
        "Google Drive is not reachable right now. Copies will resume automatically.",
      ),
    ).not.toBeInTheDocument();
  });

  it("shows the Drive notice only when the latest sync says Drive is unavailable", async () => {
    getMyRoleMock.mockResolvedValue("owner");
    usePurchaseReceiptsMock.mockReturnValue(idle);
    requestDriveReceiptSync.mockResolvedValue({
      configured: true,
      available: false,
      synced: 0,
      failed: 1,
      remaining: 1,
    });

    render(<PurchaseReceiptsPage />);

    expect(
      await screen.findByText(
        "Google Drive is not reachable right now. Copies will resume automatically.",
      ),
    ).toBeInTheDocument();
  });

  it("shows nothing about Drive when the sync says it is not configured", async () => {
    getMyRoleMock.mockResolvedValue("owner");
    usePurchaseReceiptsMock.mockReturnValue(idle);
    requestDriveReceiptSync.mockResolvedValue({ configured: false });

    render(<PurchaseReceiptsPage />);

    await waitFor(() => {
      expect(usePurchaseReceiptsMock).toHaveBeenCalledWith(true);
    });
    expect(
      screen.queryByText(
        "Google Drive is not reachable right now. Copies will resume automatically.",
      ),
    ).not.toBeInTheDocument();
  });
});
