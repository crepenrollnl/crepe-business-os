export const PURCHASE_RECEIPT_BUCKET = "purchase-receipts";
export const PURCHASE_RECEIPT_MAX_PAGES = 10;
export const PURCHASE_RECEIPT_MAX_BYTES = 8 * 1024 * 1024;
export const PURCHASE_RECEIPT_ROLES = ["owner", "partner"] as const;

export type PurchaseReceiptView = "unassigned" | "recent";

export function canManagePurchaseReceipts(role: string | null): boolean {
  return role === "owner" || role === "partner";
}

export interface PurchaseReceiptSupplierOption {
  id: string;
  name: string;
}

export interface PurchaseReceiptPageInput {
  blob: Blob;
  originalFilename: string | null;
}

export interface SavePurchaseReceiptInput {
  receiptDate: string;
  supplierId: string | null;
  receiptTotal: number | null;
  note: string | null;
  pages: PurchaseReceiptPageInput[];
}

export interface UpdatePurchaseReceiptInput {
  supplierId: string | null;
  receiptDate: string;
  receiptTotal: number | null;
  note: string | null;
}

export interface PurchaseReceiptCard {
  id: string;
  purchaseId: string | null;
  supplierId: string | null;
  supplierName: string | null;
  receiptDate: string;
  receiptTotal: number | null;
  note: string | null;
  pageCount: number;
  pagePaths: string[];
  thumbnailUrl: string | null;
}
