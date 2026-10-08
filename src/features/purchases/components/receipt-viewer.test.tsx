import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { PurchaseReceiptCard } from "../types/purchase-receipt";

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

import { ReceiptViewer } from "./receipt-viewer";

function receipt(purchaseId: string | null): PurchaseReceiptCard {
  return {
    id: "receipt-1",
    purchaseId,
    supplierId: null,
    supplierName: null,
    receiptDate: "2026-10-05",
    receiptTotal: null,
    note: null,
    pageCount: 1,
    pagePaths: ["a.jpg"],
    thumbnailUrl: null,
    files: [],
  };
}

describe("ReceiptViewer photos", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows a photo error with Retry and the linked line", async () => {
    const onRetryPhotos = vi.fn();
    render(
      <ReceiptViewer
        receipt={receipt("purchase-1")}
        pageUrls={[]}
        suppliers={[]}
        isSaving={false}
        photosLoading={false}
        error="Could not open the photo."
        onClose={vi.fn()}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        onRetryPhotos={onRetryPhotos}
      />,
    );

    expect(screen.getByText("Linked to a purchase.")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Could not open the photo.");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetryPhotos).toHaveBeenCalledTimes(1);
  });

  it("offers an Open full size link for each page", () => {
    render(
      <ReceiptViewer
        receipt={receipt(null)}
        pageUrls={["https://example.com/a.jpg", "https://example.com/b.jpg"]}
        suppliers={[]}
        isSaving={false}
        photosLoading={false}
        error={null}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        onRetryPhotos={vi.fn()}
      />,
    );

    const links = screen.getAllByRole("link", { name: "Open full size" });
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("href", "https://example.com/a.jpg");
    expect(links[0]).toHaveAttribute("rel", "noopener noreferrer");
    expect(links[1]).toHaveAttribute("href", "https://example.com/b.jpg");
    expect(links[1]).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByRole("img", { name: "Page 1" }).closest("a")).toBeNull();
    expect(screen.getByRole("img", { name: "Page 2" }).closest("a")).toBeNull();
  });

  it("shows the three drive states and retries unsynced pages", async () => {
    const onRetryDrive = vi.fn();
    const { rerender } = render(
      <ReceiptViewer
        receipt={receipt(null)}
        pageUrls={[]}
        suppliers={[]}
        isSaving={false}
        photosLoading={false}
        error={null}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        onRetryPhotos={vi.fn()}
        driveConfigured
        onRetryDrive={onRetryDrive}
      />,
    );
    expect(screen.queryByText("Drive copy pending")).not.toBeInTheDocument();

    rerender(
      <ReceiptViewer
        receipt={{
          ...receipt(null),
          files: [{ id: "page-1", driveSyncedAt: null, driveError: null }],
        }}
        pageUrls={[]}
        suppliers={[]}
        isSaving={false}
        photosLoading={false}
        error={null}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        onRetryPhotos={vi.fn()}
        driveConfigured
        onRetryDrive={onRetryDrive}
      />,
    );
    expect(screen.getByText("Drive copy pending")).toBeInTheDocument();

    rerender(
      <ReceiptViewer
        receipt={{
          ...receipt(null),
          files: [{ id: "page-1", driveSyncedAt: "2026-10-06T00:00:00.000Z", driveError: null }],
        }}
        pageUrls={[]}
        suppliers={[]}
        isSaving={false}
        photosLoading={false}
        error={null}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        onRetryPhotos={vi.fn()}
        driveConfigured
        onRetryDrive={onRetryDrive}
      />,
    );
    expect(screen.getByText("Copied to Drive")).toBeInTheDocument();

    rerender(
      <ReceiptViewer
        receipt={{
          ...receipt(null),
          files: [{ id: "page-1", driveSyncedAt: null, driveError: "Could not reach Google Drive." }],
        }}
        pageUrls={[]}
        suppliers={[]}
        isSaving={false}
        photosLoading={false}
        error={null}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        onRetryPhotos={vi.fn()}
        driveConfigured
        onRetryDrive={onRetryDrive}
      />,
    );
    expect(screen.getByText("Drive copy failed")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetryDrive).toHaveBeenCalledWith(["page-1"]);
  });

  it("shows nothing about Drive when it is not configured", () => {
    render(
      <ReceiptViewer
        receipt={{
          ...receipt(null),
          files: [{ id: "page-1", driveSyncedAt: null, driveError: "Could not reach Google Drive." }],
        }}
        pageUrls={[]}
        suppliers={[]}
        isSaving={false}
        photosLoading={false}
        error={null}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        onRetryPhotos={vi.fn()}
      />,
    );

    expect(screen.queryByText("Drive copy failed")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });
});

describe("ReceiptViewer Enter purchase", () => {
  afterEach(() => {
    cleanup();
    pushMock.mockReset();
  });

  function renderViewer(
    card: PurchaseReceiptCard,
    onSave: ReturnType<typeof vi.fn> = vi.fn(),
  ) {
    render(
      <ReceiptViewer
        receipt={card}
        pageUrls={[]}
        suppliers={[{ id: "supplier-1", name: "Sligro" }]}
        isSaving={false}
        photosLoading={false}
        error={null}
        onClose={vi.fn()}
        onSave={onSave}
        onDiscard={vi.fn()}
        onRetryPhotos={vi.fn()}
      />,
    );
  }

  it("opens the purchase form without saving when nothing changed", async () => {
    const onSave = vi.fn();
    renderViewer({ ...receipt(null), id: "receipt 1/x" }, onSave);

    await userEvent.click(screen.getByRole("button", { name: "Enter purchase" }));

    expect(onSave).not.toHaveBeenCalled();
    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledWith("/purchases?fromReceipt=receipt%201%2Fx");
  });

  it("saves edited values before opening the purchase form", async () => {
    const onSave = vi.fn().mockResolvedValue({ error: null });
    renderViewer(receipt(null), onSave);

    await userEvent.selectOptions(screen.getByRole("combobox"), "supplier-1");
    await userEvent.click(screen.getByRole("button", { name: "Enter purchase" }));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({
      supplierId: "supplier-1",
      receiptDate: "2026-10-05",
      receiptTotal: null,
      note: null,
    });
    expect(pushMock).toHaveBeenCalledWith("/purchases?fromReceipt=receipt-1");
    expect(onSave.mock.invocationCallOrder[0]).toBeLessThan(
      pushMock.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("stays on the receipt when saving the edits fails", async () => {
    const onSave = vi.fn().mockResolvedValue({ error: "Could not update the receipt." });
    renderViewer(receipt(null), onSave);

    await userEvent.selectOptions(screen.getByRole("combobox"), "supplier-1");
    await userEvent.click(screen.getByRole("button", { name: "Enter purchase" }));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(pushMock).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Could not update the receipt.");
  });

  it("does not offer Enter purchase for a linked receipt", () => {
    renderViewer(receipt("purchase-1"));

    expect(screen.queryByRole("button", { name: "Enter purchase" })).not.toBeInTheDocument();
  });
});
