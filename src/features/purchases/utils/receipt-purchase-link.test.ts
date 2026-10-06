import { describe, expect, it } from "vitest";
import { formatMoney } from "@/lib/money";
import type { PurchaseReceiptCard } from "../types/purchase-receipt";
import {
  compareUnassignedReceipts,
  linkedReceiptTotalMessage,
  missingSignedPage,
} from "./receipt-purchase-link";

function card(
  id: string,
  supplierId: string | null,
  receiptDate: string,
): PurchaseReceiptCard {
  return {
    id,
    purchaseId: null,
    supplierId,
    supplierName: null,
    receiptDate,
    receiptTotal: null,
    note: null,
    pageCount: 1,
    pagePaths: [],
    thumbnailUrl: null,
  };
}

describe("receipt purchase link helpers", () => {
  it("puts the same supplier first, then the closest receipt date", () => {
    const purchaseDate = "2026-10-05";
    const rows = [
      card("far-other", "other", "2026-08-01"),
      card("same", "supplier-1", "2026-09-01"),
      card("close-other", "other", "2026-10-05"),
    ].sort((left, right) =>
      compareUnassignedReceipts(left, right, "supplier-1", purchaseDate),
    );

    expect(rows.map((row) => row.id)).toEqual(["same", "close-other", "far-other"]);
  });

  it("matches within half a cent, reports a difference, and hides a missing total", () => {
    expect(linkedReceiptTotalMessage([{ receiptTotal: 13.2 }], 13.204)).toBe(
      `Receipt total ${formatMoney(13.2)} — matches the purchase total.`,
    );
    expect(linkedReceiptTotalMessage([{ receiptTotal: 13.2 }], 12.9)).toBe(
      `Receipt total ${formatMoney(13.2)} — differs from the purchase total ${formatMoney(12.9)} by ${formatMoney(0.3)}.`,
    );
    expect(
      linkedReceiptTotalMessage(
        [{ receiptTotal: 13.2 }, { receiptTotal: null }],
        13.2,
      ),
    ).toBeNull();
    expect(linkedReceiptTotalMessage([], 13.2)).toBeNull();
  });

  it("treats a missing page URL as a failed open", () => {
    expect(missingSignedPage(["a.jpg", "b.jpg"], ["https://signed.example/a", null])).toBe(
      true,
    );
    expect(missingSignedPage(["a.jpg"], ["https://signed.example/a"])).toBe(false);
    expect(missingSignedPage([], [])).toBe(false);
  });
});
