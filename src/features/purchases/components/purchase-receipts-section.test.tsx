import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { formatMoney } from "@/lib/money";
import type { PurchaseStatus } from "../types/purchase";
import type { PurchaseReceiptCard } from "../types/purchase-receipt";
import { formatReceiptDisplayDate } from "../utils/receipt-purchase-link";
import { PurchaseReceiptsSection } from "./purchase-receipts-section";

const {
  getMyRole,
  listForPurchase,
  listUnassigned,
  listActiveSuppliers,
  linkToPurchase,
  unlinkFromPurchase,
  signStoragePaths,
} = vi.hoisted(() => ({
  getMyRole: vi.fn(),
  listForPurchase: vi.fn(),
  listUnassigned: vi.fn(),
  listActiveSuppliers: vi.fn(),
  linkToPurchase: vi.fn(),
  unlinkFromPurchase: vi.fn(),
  signStoragePaths: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@/features/auth/services/auth-service", () => ({
  authService: {
    getMyRole: () => getMyRole(),
  },
}));

vi.mock("../services/purchase-receipt-service", () => ({
  purchaseReceiptService: {
    listForPurchase: (purchaseId: string) => listForPurchase(purchaseId),
    listUnassigned: () => listUnassigned(),
    listActiveSuppliers: () => listActiveSuppliers(),
    linkToPurchase: (receiptId: string, purchaseId: string) =>
      linkToPurchase(receiptId, purchaseId),
    unlinkFromPurchase: (receiptId: string, purchaseId: string) =>
      unlinkFromPurchase(receiptId, purchaseId),
    signStoragePaths: (paths: string[]) => signStoragePaths(paths),
    update: vi.fn(),
    discard: vi.fn(),
  },
}));

function card(overrides: Partial<PurchaseReceiptCard>): PurchaseReceiptCard {
  return {
    id: "receipt-1",
    purchaseId: null,
    supplierId: null,
    supplierName: "Makro",
    receiptDate: "2026-10-05",
    receiptTotal: 14.68,
    note: null,
    pageCount: 2,
    pagePaths: ["a.jpg"],
    thumbnailUrl: "https://signed.example/thumb",
    files: [],
    ...overrides,
  };
}

function renderSection(
  overrides: Partial<{
    purchaseId: string | null;
    status: PurchaseStatus;
    supplierId: string | null;
    purchasedAt: string;
    grandTotal: number;
    driveUnavailable: boolean;
  }> = {},
) {
  return render(
    <PurchaseReceiptsSection
      purchaseId="purchase-1"
      status="draft"
      supplierId="supplier-1"
      purchasedAt="2026-10-05"
      grandTotal={14.68}
      {...overrides}
    />,
  );
}

describe("PurchaseReceiptsSection", () => {
  beforeEach(() => {
    getMyRole.mockResolvedValue("owner");
    listForPurchase.mockResolvedValue({ data: [], error: null });
    listUnassigned.mockResolvedValue({ data: [], error: null });
    listActiveSuppliers.mockResolvedValue({ data: [], error: null });
    linkToPurchase.mockResolvedValue({ data: true, error: null });
    unlinkFromPurchase.mockResolvedValue({ data: true, error: null });
    signStoragePaths.mockResolvedValue({
      data: ["https://signed.example/page"],
      error: null,
    });
  });

  afterEach(() => {
    cleanup();
    getMyRole.mockReset();
    listForPurchase.mockReset();
    listUnassigned.mockReset();
    listActiveSuppliers.mockReset();
    linkToPurchase.mockReset();
    unlinkFromPurchase.mockReset();
    signStoragePaths.mockReset();
  });

  it("asks for a saved draft before a receipt can be attached", async () => {
    renderSection({ purchaseId: null });

    expect(await screen.findByText("Save the draft to attach a receipt.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Attach receipt" })).not.toBeInTheDocument();
    expect(listForPurchase).not.toHaveBeenCalled();
  });

  it("lists a linked receipt and opens it", async () => {
    listForPurchase.mockResolvedValue({
      data: [card({ purchaseId: "purchase-1" })],
      error: null,
    });
    renderSection();

    expect(await screen.findByText(formatReceiptDisplayDate("2026-10-05"))).toBeInTheDocument();
    expect(screen.getByText("Makro")).toBeInTheDocument();
    expect(screen.getByText(formatMoney(14.68))).toBeInTheDocument();
    expect(screen.getByText("2 pages")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Makro/ }));
    expect(await screen.findByRole("button", { name: "Close" })).toBeInTheDocument();
    expect(screen.getByText("Linked to a purchase.")).toBeInTheDocument();
    expect(signStoragePaths).toHaveBeenCalledWith(["a.jpg"]);
  });

  it("links the chosen receipt onto the purchase", async () => {
    const chosen = card({ id: "chosen", supplierName: "Chosen shop" });
    listUnassigned.mockResolvedValue({ data: [chosen], error: null });
    listForPurchase
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValue({
        data: [card({ id: "chosen", purchaseId: "purchase-1", supplierName: "Chosen shop" })],
        error: null,
      });
    renderSection();

    await userEvent.click(await screen.findByRole("button", { name: "Attach receipt" }));
    await userEvent.click(await screen.findByRole("button", { name: /Chosen shop/ }));

    expect(linkToPurchase).toHaveBeenCalledWith("chosen", "purchase-1");
    expect(await screen.findByRole("button", { name: /Chosen shop/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Attach receipt" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: /Chosen shop/ })).toHaveLength(1);
    });
  });

  it("orders the picker by supplier, then by date distance", async () => {
    listUnassigned.mockResolvedValue({
      data: [
        card({
          id: "far",
          supplierId: "other",
          supplierName: "Other far",
          receiptDate: "2026-08-01",
        }),
        card({
          id: "same",
          supplierId: "supplier-1",
          supplierName: "Same shop",
          receiptDate: "2026-09-01",
        }),
        card({
          id: "close",
          supplierId: "other",
          supplierName: "Other close",
          receiptDate: "2026-10-05",
        }),
      ],
      error: null,
    });
    renderSection();

    await userEvent.click(await screen.findByRole("button", { name: "Attach receipt" }));
    await screen.findByRole("button", { name: /Same shop/ });

    const labels = screen.getAllByRole("button").map((button) => button.textContent ?? "");
    const same = labels.findIndex((label) => label.includes("Same shop"));
    const close = labels.findIndex((label) => label.includes("Other close"));
    const far = labels.findIndex((label) => label.includes("Other far"));
    expect(same).toBeGreaterThanOrEqual(0);
    expect(same).toBeLessThan(close);
    expect(close).toBeLessThan(far);
  });

  it("links a chosen receipt and refreshes the picker when it is no longer unassigned", async () => {
    const same = card({
      id: "same",
      supplierId: "supplier-1",
      supplierName: "Same shop",
    });
    listUnassigned
      .mockResolvedValueOnce({ data: [same], error: null })
      .mockResolvedValueOnce({ data: [], error: null });
    linkToPurchase.mockResolvedValue({
      data: null,
      error: "This receipt is no longer unassigned.",
    });
    renderSection();

    await userEvent.click(await screen.findByRole("button", { name: "Attach receipt" }));
    await userEvent.click(await screen.findByRole("button", { name: /Same shop/ }));

    expect(linkToPurchase).toHaveBeenCalledWith("same", "purchase-1");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This receipt is no longer unassigned.",
    );
    await waitFor(() => expect(listUnassigned).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("button", { name: /Same shop/ })).not.toBeInTheDocument();
  });

  it("offers attach and unlink on a draft or received purchase, and neither when cancelled", async () => {
    listForPurchase.mockResolvedValue({
      data: [card({ id: "linked", purchaseId: "purchase-1", supplierName: "Makro" })],
      error: null,
    });
    const { rerender } = renderSection({ status: "draft" });

    await userEvent.click(await screen.findByRole("button", { name: "Unlink" }));
    expect(unlinkFromPurchase).toHaveBeenCalledWith("linked", "purchase-1");
    expect(screen.getByRole("button", { name: "Attach receipt" })).toBeInTheDocument();

    rerender(
      <PurchaseReceiptsSection
        purchaseId="purchase-1"
        status="received"
        supplierId="supplier-1"
        purchasedAt="2026-10-05"
        grandTotal={14.68}
      />,
    );
    expect(screen.getByRole("button", { name: "Attach receipt" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Unlink" }));
    expect(unlinkFromPurchase).toHaveBeenCalledTimes(2);

    rerender(
      <PurchaseReceiptsSection
        purchaseId="purchase-1"
        status="cancelled"
        supplierId="supplier-1"
        purchasedAt="2026-10-05"
        grandTotal={14.68}
      />,
    );
    expect(screen.queryByRole("button", { name: "Attach receipt" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Unlink" })).not.toBeInTheDocument();
    expect(screen.getByText("Makro")).toBeInTheDocument();
  });

  it("cancels the attach picker without linking and does not open a second one", async () => {
    const same = card({ id: "same", supplierName: "Same shop" });
    listUnassigned.mockResolvedValue({ data: [same], error: null });
    linkToPurchase.mockResolvedValue({
      data: null,
      error: "This receipt is no longer unassigned.",
    });
    renderSection();

    await userEvent.click(await screen.findByRole("button", { name: "Attach receipt" }));
    await screen.findByRole("button", { name: /Same shop/ });
    const callsAfterOpen = listUnassigned.mock.calls.length;

    await userEvent.click(screen.getByRole("button", { name: "Attach receipt" }));
    expect(listUnassigned).toHaveBeenCalledTimes(callsAfterOpen);

    await userEvent.click(screen.getByRole("button", { name: /Same shop/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This receipt is no longer unassigned.",
    );

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(linkToPurchase).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Same shop/ })).not.toBeInTheDocument();
  });

  it("shows a match, a difference, or nothing for the receipt total check", async () => {
    listForPurchase.mockResolvedValue({
      data: [card({ receiptTotal: 13.2, supplierName: "Match shop" })],
      error: null,
    });
    const { rerender } = renderSection({ grandTotal: 13.2 });

    expect(
      await screen.findByText(
        `Receipt total ${formatMoney(13.2)} — matches the purchase total.`,
      ),
    ).toBeInTheDocument();

    rerender(
      <PurchaseReceiptsSection
        purchaseId="purchase-1"
        status="draft"
        supplierId="supplier-1"
        purchasedAt="2026-10-05"
        grandTotal={12.9}
      />,
    );
    expect(
      screen.getByText(
        `Receipt total ${formatMoney(13.2)} — differs from the purchase total ${formatMoney(12.9)} by ${formatMoney(0.3)}.`,
      ),
    ).toBeInTheDocument();

    listForPurchase.mockResolvedValue({
      data: [card({ receiptTotal: null, supplierName: "No total shop" })],
      error: null,
    });
    rerender(
      <PurchaseReceiptsSection
        purchaseId="purchase-2"
        status="draft"
        supplierId="supplier-1"
        purchasedAt="2026-10-05"
        grandTotal={12.9}
      />,
    );
    await screen.findByText("No total");
    expect(screen.queryByText(/Receipt total/)).not.toBeInTheDocument();
  });

  it("shows the Drive notice in the receipts section only when Drive is unavailable", async () => {
    const notice = "Google Drive is not reachable right now. Copies will resume automatically.";
    renderSection();
    expect(await screen.findByRole("heading", { name: "Receipts" })).toBeInTheDocument();
    expect(screen.queryByText(notice)).not.toBeInTheDocument();

    cleanup();
    renderSection({ driveUnavailable: true });
    expect(await screen.findByText(notice)).toBeInTheDocument();
  });
});
