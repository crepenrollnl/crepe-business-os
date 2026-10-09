export const RECEIPT_LINE_KINDS = ["item", "discount", "deposit", "bag", "other"] as const;

export type ReceiptLineKind = (typeof RECEIPT_LINE_KINDS)[number];

export const RECEIPT_RECOGNITION_SCHEMA_VERSION = 1;

export interface ReceiptRecognitionLine {
  text: string;
  quantity: number | null;
  unitPrice: number | null;
  lineTotal: number;
  vatRate: number | null;
  kind: ReceiptLineKind;
}

/** Normalized AI reading of one receipt, as stored in purchase_receipt_recognitions.result. */
export interface ReceiptRecognitionResult {
  schemaVersion: typeof RECEIPT_RECOGNITION_SCHEMA_VERSION;
  readable: boolean;
  storeName: string | null;
  receiptDate: string | null;
  currency: string | null;
  total: number | null;
  lines: ReceiptRecognitionLine[];
}

export type ReceiptRecognitionRequestResult =
  | { status: "not_configured" }
  | {
      status: "ok";
      cached: boolean;
      recognitionId: string;
      result: ReceiptRecognitionResult;
    }
  | { status: "error"; message: string };
