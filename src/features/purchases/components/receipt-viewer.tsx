"use client";

import { useState } from "react";
import { parseNumericInput, sanitizeNumericInput } from "@/components/ui/numeric-input";
import { formatLastPurchaseHintDate } from "../utils/apply-last-purchase-prefill";
import type {
  PurchaseReceiptCard,
  PurchaseReceiptSupplierOption,
  UpdatePurchaseReceiptInput,
} from "../types/purchase-receipt";
import { ReceiptDiscardDialog } from "./receipt-discard-dialog";

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
}

const fieldClassName =
  "block w-full rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base text-zinc-900";

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

  const shownError = localError ?? error;

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-zinc-950">
      <header className="flex items-center justify-between gap-3 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 text-white">
        <button type="button" onClick={onClose} className="min-h-12 px-2 text-base font-semibold">
          Close
        </button>
        <p className="text-base font-semibold">
          {formatLastPurchaseHintDate(
            receipt.receiptDate.includes("T")
              ? receipt.receiptDate
              : `${receipt.receiptDate}T12:00:00`,
          )}
        </p>
        <span className="w-16" />
      </header>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-zinc-50 px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="space-y-3">
          {photosLoading ? <p className="text-sm text-zinc-600">Loading photo…</p> : null}
          {pageUrls.map((url, index) => (
            // eslint-disable-next-line @next/next/no-img-element -- private signed URL, browser pinch zoom
            <img
              key={url}
              src={url}
              alt={`Page ${index + 1}`}
              className="w-full rounded-xl bg-white"
            />
          ))}
        </div>

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
        <label className="block space-y-1 text-sm font-medium text-zinc-700">
          Receipt date
          <input
            type="date"
            value={receiptDate}
            onChange={(event) => setReceiptDate(event.target.value)}
            className={fieldClassName}
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
        {shownError ? (
          <p role="alert" className="text-sm text-red-700">
            {shownError}
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
      <ReceiptDiscardDialog
        open={discardOpen}
        isDiscarding={isSaving}
        error={discardError}
        onClose={() => setDiscardOpen(false)}
        onConfirm={() => void confirmDiscard()}
      />
    </div>
  );
}
