"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { parseNumericInput, sanitizeNumericInput } from "@/components/ui/numeric-input";
import { formatReceiptDisplayDate } from "../utils/receipt-purchase-link";
import type {
  PurchaseReceiptCard,
  PurchaseReceiptSupplierOption,
  UpdatePurchaseReceiptInput,
} from "../types/purchase-receipt";
import { ReceiptDiscardDialog } from "./receipt-discard-dialog";
import { ReceiptDriveStatus } from "./receipt-drive-status";

interface ReceiptViewerProps {
  receipt: PurchaseReceiptCard;
  pageUrls: string[];
  suppliers: PurchaseReceiptSupplierOption[];
  isSaving: boolean;
  photosLoading: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (input: UpdatePurchaseReceiptInput) => Promise<{ error: string | null }>;
  onDiscard: (receipt: PurchaseReceiptCard) => Promise<{ error: string | null }>;
  onRetryPhotos: () => void;
  driveConfigured?: boolean;
  onRetryDrive?: (fileIds: string[]) => void;
}

const fieldClassName =
  "block w-full rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base text-zinc-900";

const dateFieldClassName = `${fieldClassName} min-w-0 max-w-full appearance-none`;

export function ReceiptViewer({
  receipt,
  pageUrls,
  suppliers,
  isSaving,
  photosLoading,
  error,
  onClose,
  onSave,
  onDiscard,
  onRetryPhotos,
  driveConfigured = false,
  onRetryDrive,
}: ReceiptViewerProps) {
  const [supplierId, setSupplierId] = useState(receipt.supplierId ?? "");
  const [receiptDate, setReceiptDate] = useState(receipt.receiptDate);
  const [receiptTotal, setReceiptTotal] = useState(
    receipt.receiptTotal === null ? "" : String(receipt.receiptTotal),
  );
  const [note, setNote] = useState(receipt.note ?? "");
  const [localError, setLocalError] = useState<string | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [discardError, setDiscardError] = useState<string | null>(null);

  async function handleSave() {
    if (receiptDate.trim().length === 0) {
      setLocalError("Receipt date is required.");
      return;
    }

    const trimmedTotal = receiptTotal.trim();
    let parsedTotal: number | null = null;
    if (trimmedTotal.length > 0) {
      parsedTotal = parseNumericInput(trimmedTotal);
      if (parsedTotal === null || parsedTotal < 0) {
        setLocalError("Enter a valid receipt total.");
        return;
      }
    }

    const trimmedNote = note.trim();
    const result = await onSave({
      supplierId: supplierId.length > 0 ? supplierId : null,
      receiptDate,
      receiptTotal: parsedTotal,
      note: trimmedNote.length > 0 ? trimmedNote : null,
    });
    if (result.error) {
      setLocalError(result.error);
      return;
    }
    setLocalError(null);
  }

  async function confirmDiscard() {
    const result = await onDiscard(receipt);
    if (result.error) {
      setDiscardError(result.error);
      return;
    }
    setDiscardOpen(false);
  }

  const viewer = (
    <div className="fixed inset-0 z-[60] flex flex-col bg-zinc-950">
      <header className="flex items-center justify-between gap-3 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 text-white">
        <button type="button" onClick={onClose} className="min-h-12 px-2 text-base font-semibold">
          Close
        </button>
        <p className="text-base font-semibold">{formatReceiptDisplayDate(receipt.receiptDate)}</p>
        <span className="w-16" />
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto bg-zinc-50">
        <div className="mx-auto w-full max-w-2xl space-y-4 px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {receipt.purchaseId ? (
          <p className="text-sm font-medium text-zinc-700">Linked to a purchase.</p>
        ) : null}
        <div className="space-y-3">
          {photosLoading ? <p className="text-sm text-zinc-600">Loading photo…</p> : null}
          {!photosLoading && error ? (
            <div className="space-y-3">
              <p role="alert" className="text-sm text-red-700">
                {error}
              </p>
              <button
                type="button"
                onClick={onRetryPhotos}
                className="min-h-12 rounded-lg bg-white px-4 text-base font-semibold text-zinc-900"
              >
                Retry
              </button>
            </div>
          ) : null}
          {!photosLoading && !error
            ? pageUrls.map((url, index) => (
                <div key={url} className="space-y-1">
                  {/* eslint-disable-next-line @next/next/no-img-element -- private signed URL, browser pinch zoom */}
                  <img
                    src={url}
                    alt={`Page ${index + 1}`}
                    className="mx-auto block h-auto w-auto max-w-full rounded-xl bg-white"
                  />
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-center text-sm text-zinc-600 underline"
                  >
                    Open full size
                  </a>
                </div>
              ))
            : null}
        </div>

        <ReceiptDriveStatus
          configured={driveConfigured}
          files={receipt.files}
          onRetry={onRetryDrive ?? (() => undefined)}
        />

        <label className="block space-y-1 text-sm font-medium text-zinc-700">
          Supplier
          <select
            value={supplierId}
            onChange={(event) => setSupplierId(event.target.value)}
            className={fieldClassName}
          >
            <option value="">No supplier</option>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block min-w-0 w-full space-y-1 text-sm font-medium text-zinc-700">
          Receipt date
          <input
            type="date"
            value={receiptDate}
            onChange={(event) => setReceiptDate(event.target.value)}
            className={dateFieldClassName}
          />
        </label>
        <label className="block space-y-1 text-sm font-medium text-zinc-700">
          Receipt total
          <input
            inputMode="decimal"
            value={receiptTotal}
            onChange={(event) => setReceiptTotal(sanitizeNumericInput(event.target.value))}
            className={fieldClassName}
          />
        </label>
        <label className="block space-y-1 text-sm font-medium text-zinc-700">
          Note
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            className={fieldClassName}
          />
        </label>
        {localError ? (
          <p role="alert" className="text-sm text-red-700">
            {localError}
          </p>
        ) : null}
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={isSaving}
          className="min-h-12 w-full rounded-lg bg-zinc-900 text-base font-semibold text-white disabled:opacity-60"
        >
          {isSaving ? "Saving…" : "Save changes"}
        </button>
        {receipt.purchaseId === null ? (
          <button
            type="button"
            onClick={() => {
              setDiscardError(null);
              setDiscardOpen(true);
            }}
            className="min-h-12 w-full rounded-lg border border-zinc-300 text-base font-semibold text-zinc-800"
          >
            Discard
          </button>
        ) : null}
        </div>
      </div>
      <ReceiptDiscardDialog
        open={discardOpen}
        isDiscarding={isSaving}
        error={discardError}
        onClose={() => setDiscardOpen(false)}
        onConfirm={() => void confirmDiscard()}
      />
    </div>
  );

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(viewer, document.body);
}
