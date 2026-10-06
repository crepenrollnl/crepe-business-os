import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { PurchaseReceiptCard } from "../types/purchase-receipt";
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
});
