import { formatMoney } from "@/lib/money";
import type { PurchaseReceiptCard } from "../types/purchase-receipt";
import { formatLastPurchaseHintDate } from "./apply-last-purchase-prefill";

const HALF_CENT = 0.005;

export const RECEIPT_NO_LONGER_UNASSIGNED =
  "This receipt is no longer unassigned.";

export function formatReceiptDisplayDate(isoDate: string): string {
  const value = isoDate.includes("T") ? isoDate : `${isoDate}T12:00:00`;
  return formatLastPurchaseHintDate(value);
}

function calendarNoon(isoDate: string): number {
  const day = isoDate.slice(0, 10);
  return Date.parse(`${day}T12:00:00`);
}

export function compareUnassignedReceipts(
  left: PurchaseReceiptCard,
  right: PurchaseReceiptCard,
  supplierId: string | null,
  purchaseDate: string,
): number {
  const leftSame = left.supplierId === supplierId ? 0 : 1;
  const rightSame = right.supplierId === supplierId ? 0 : 1;
  if (leftSame !== rightSame) {
    return leftSame - rightSame;
  }

  const purchaseNoon = calendarNoon(purchaseDate);
  const leftDistance = Math.abs(calendarNoon(left.receiptDate) - purchaseNoon);
  const rightDistance = Math.abs(calendarNoon(right.receiptDate) - purchaseNoon);
  if (leftDistance !== rightDistance) {
    return leftDistance - rightDistance;
  }

  if (left.id < right.id) {
    return -1;
  }
  if (left.id > right.id) {
    return 1;
  }
  return 0;
}

export function linkedReceiptTotalMessage(
  receipts: ReadonlyArray<{ receiptTotal: number | null }>,
  purchaseTotal: number,
): string | null {
  if (receipts.length === 0) {
    return null;
  }
  if (receipts.some((receipt) => receipt.receiptTotal === null)) {
    return null;
  }

  const sum = receipts.reduce(
    (total, receipt) => total + (receipt.receiptTotal ?? 0),
    0,
  );
  const difference = Math.abs(sum - purchaseTotal);
  if (difference <= HALF_CENT) {
    return `Receipt total ${formatMoney(sum)} — matches the purchase total.`;
  }

  return `Receipt total ${formatMoney(sum)} — differs from the purchase total ${formatMoney(purchaseTotal)} by ${formatMoney(difference)}.`;
}

export function missingSignedPage(
  paths: readonly string[],
  urls: ReadonlyArray<string | null>,
): boolean {
  if (paths.length === 0) {
    return false;
  }
  if (urls.length !== paths.length) {
    return true;
  }
  return paths.some((_, index) => {
    const url = urls[index];
    return typeof url !== "string" || url.length === 0;
  });
}
