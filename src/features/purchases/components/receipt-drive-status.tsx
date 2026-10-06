"use client";

import type { PurchaseReceiptFileDrive } from "../types/purchase-receipt";
import { deriveDriveCopyState, unsyncedDriveFileIds } from "../utils/drive-receipt-copy";

export const DRIVE_UNAVAILABLE_NOTICE =
  "Google Drive is not reachable right now. Copies will resume automatically.";

export function DriveUnavailableNotice() {
  return <p className="text-sm text-zinc-600">{DRIVE_UNAVAILABLE_NOTICE}</p>;
}

interface ReceiptDriveStatusProps {
  configured: boolean;
  files: PurchaseReceiptFileDrive[];
  onRetry: (fileIds: string[]) => void;
  className?: string;
}

export function ReceiptDriveStatus({
  configured,
  files,
  onRetry,
  className,
}: ReceiptDriveStatusProps) {
  if (!configured) {
    return null;
  }

  const state = deriveDriveCopyState(files);
  if (state === null) {
    return null;
  }
  const spacing = className ? ` ${className}` : "";
  if (state === "copied") {
    return <p className={`text-sm text-zinc-600${spacing}`}>Copied to Drive</p>;
  }
  if (state === "pending") {
    return <p className={`text-sm text-zinc-600${spacing}`}>Drive copy pending</p>;
  }

  return (
    <div className={`space-y-2${spacing}`}>
      <p className="text-sm text-red-700">Drive copy failed</p>
      <button
        type="button"
        onClick={() => onRetry(unsyncedDriveFileIds(files))}
        className="min-h-12 w-full rounded-lg border border-zinc-300 text-base font-semibold text-zinc-800"
      >
        Retry
      </button>
    </div>
  );
}
