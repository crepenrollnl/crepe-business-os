import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { formatMoney } from "@/lib/money";
import type { PurchaseReceiptCard } from "../types/purchase-receipt";
import { formatLastPurchaseHintDate } from "../utils/apply-last-purchase-prefill";
import { ReceiptList } from "./receipt-list";

function card(overrides: Partial<PurchaseReceiptCard>): PurchaseReceiptCard {
  return {
    id: "receipt-1",
    purchaseId: null,
    supplierId: null,
    supplierName: null,
    receiptDate: "2026-10-05",
    receiptTotal: null,
    note: null,
    pageCount: 1,
    pagePaths: [],
    thumbnailUrl: null,
    ...overrides,
  };
}

describe("ReceiptList", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows the empty unassigned state and switches views", async () => {
    const onViewChange = vi.fn();
    render(
      <ReceiptList
        view="unassigned"
        receipts={[]}
        loading={false}
        error={null}
        onViewChange={onViewChange}
        onRetry={vi.fn()}
        onOpen={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );

    expect(screen.getByText("No unassigned receipts.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "All recent" }));
    expect(onViewChange).toHaveBeenCalledWith("recent");
  });

  it("shows the recent empty state", () => {
    render(
      <ReceiptList
        view="recent"
        receipts={[]}
        loading={false}
        error={null}
        onViewChange={vi.fn()}
        onRetry={vi.fn()}
        onOpen={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );

    expect(screen.getByText("No receipts in the last 60 days.")).toBeInTheDocument();
  });

  it("formats the date and total and lazy-loads the thumbnail", () => {
    render(
      <ReceiptList
        view="unassigned"
        receipts={[
          card({
            receiptDate: "2026-09-26",
            receiptTotal: 14.68,
            thumbnailUrl: "https://signed.example/photo",
          }),
          card({
            id: "older",
            receiptDate: "2025-09-26",
            receiptTotal: null,
            supplierName: "Old shop",
          }),
        ]}
        loading={false}
        error={null}
        onViewChange={vi.fn()}
        onRetry={vi.fn()}
        onOpen={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );

    expect(screen.getByText(formatLastPurchaseHintDate("2026-09-26T12:00:00"))).toBeInTheDocument();
    expect(screen.getByText(formatLastPurchaseHintDate("2025-09-26T12:00:00"))).toBeInTheDocument();
    expect(screen.getByText(formatMoney(14.68))).toBeInTheDocument();
    expect(screen.getByText("No total")).toBeInTheDocument();
    expect(screen.getByText("No supplier")).toBeInTheDocument();
    const image = document.querySelector("img");
    expect(image).toHaveAttribute("loading", "lazy");
    expect(image).toHaveAttribute("decoding", "async");
  });

  it("offers discard only for an unassigned receipt", async () => {
    const onDiscard = vi.fn().mockResolvedValue({ error: null });
    render(
      <ReceiptList
        view="recent"
        receipts={[
          card({ id: "open", purchaseId: null, supplierName: "Makro" }),
          card({
            id: "linked",
            purchaseId: "purchase-1",
            supplierName: "Sligro",
            receiptDate: "2026-10-04",
          }),
        ]}
        loading={false}
        error={null}
        onViewChange={vi.fn()}
        onRetry={vi.fn()}
        onOpen={vi.fn()}
        onDiscard={onDiscard}
      />,
    );

    expect(screen.getAllByRole("button", { name: "Discard" })).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.getByRole("heading", { name: "Discard this receipt?" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Discard receipt" }));
    expect(onDiscard).toHaveBeenCalledWith(expect.objectContaining({ id: "open" }));
  });

  it("shows Linked only in All recent for a linked receipt", () => {
    const linked = card({
      id: "linked",
      purchaseId: "purchase-1",
      supplierName: "Sligro",
    });
    const { rerender } = render(
      <ReceiptList
        view="unassigned"
        receipts={[linked]}
        loading={false}
        error={null}
        onViewChange={vi.fn()}
        onRetry={vi.fn()}
        onOpen={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );

    expect(screen.queryByText("Linked")).not.toBeInTheDocument();

    rerender(
      <ReceiptList
        view="recent"
        receipts={[linked]}
        loading={false}
        error={null}
        onViewChange={vi.fn()}
        onRetry={vi.fn()}
        onOpen={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );

    expect(screen.getByText("Linked")).toBeInTheDocument();
  });
});
