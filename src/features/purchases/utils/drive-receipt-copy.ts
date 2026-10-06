import type { PurchaseReceiptFileDrive } from "../types/purchase-receipt";

export const DRIVE_ERROR_MAX_LENGTH = 200;
export const DRIVE_AUTOMATIC_BATCH = 3;
export const DRIVE_MANUAL_BATCH = 10;
export const DRIVE_ATTEMPT_CAP = 5;

const INVALID_FILE_NAME = /[/\\:*?"<>|\u0000-\u001f]/g;

export type DriveCopyState = "copied" | "pending" | "failed";

export function sanitizeDriveFileName(value: string): string {
  return value.replace(INVALID_FILE_NAME, " ").replace(/\s+/g, " ").trim();
}

export function buildDriveReceiptFileName(input: {
  receiptDate: string;
  supplierName: string | null;
  receiptTotal: number | null;
  pageNumber: number;
  pageCount: number;
  fileId: string;
}): string {
  const supplier = sanitizeDriveFileName(input.supplierName ?? "") || "no-supplier";
  const total =
    input.receiptTotal === null || !Number.isFinite(input.receiptTotal)
      ? "no-total"
      : input.receiptTotal.toFixed(2);
  const page = input.pageCount > 1 ? `_p${input.pageNumber}` : "";
  const prefix = input.fileId.slice(0, 8);
  return sanitizeDriveFileName(`${input.receiptDate}_${supplier}_${total}${page}_${prefix}.jpg`);
}

export function driveFoldersFromReceiptDate(
  receiptDate: string,
): { root: "Receipts"; year: string; month: string } | null {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(receiptDate);
  if (!match) {
    return null;
  }
  return { root: "Receipts", year: match[1], month: match[2] };
}

export function deriveDriveCopyState(
  files: PurchaseReceiptFileDrive[],
): DriveCopyState | null {
  if (files.length === 0) {
    return null;
  }
  const unsynced = files.filter((file) => file.driveSyncedAt === null);
  if (unsynced.length === 0) {
    return "copied";
  }
  if (unsynced.some((file) => file.driveError)) {
    return "failed";
  }
  return "pending";
}

export function unsyncedDriveFileIds(files: PurchaseReceiptFileDrive[]): string[] {
  return files.filter((file) => file.driveSyncedAt === null).map((file) => file.id);
}

export function clampDriveError(message: string): string {
  return message.length <= DRIVE_ERROR_MAX_LENGTH
    ? message
    : message.slice(0, DRIVE_ERROR_MAX_LENGTH);
}

export function driveHttpFailure(
  status: number,
  action: "upload" | "sign-in" | "request",
): string {
  if (action === "upload") {
    return `Google Drive refused the upload (${status}).`;
  }
  if (action === "sign-in") {
    return `Google Drive refused the sign-in (${status}).`;
  }
  return `Google Drive refused the request (${status}).`;
}

export function redactSecrets(message: string, secrets: readonly string[]): string {
  let next = message;
  for (const secret of secrets) {
    if (secret.length === 0) {
      continue;
    }
    next = next.split(secret).join("[redacted]");
  }
  return next.replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
}

export function safeDriveErrorMessage(
  error: unknown,
  secrets: readonly string[],
): string {
  const fallback = "Could not reach Google Drive.";
  if (!(error instanceof Error) || error.name !== "SafeDriveFailure") {
    return fallback;
  }
  const redacted = redactSecrets(error.message, secrets);
  if (redacted !== error.message) {
    return fallback;
  }
  return clampDriveError(redacted);
}
