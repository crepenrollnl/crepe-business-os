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
});
