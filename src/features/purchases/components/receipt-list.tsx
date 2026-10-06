"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/money";
import type { PurchaseReceiptCard, PurchaseReceiptView } from "../types/purchase-receipt";
import { formatLastPurchaseHintDate } from "../utils/apply-last-purchase-prefill";
import { ReceiptDiscardDialog } from "./receipt-discard-dialog";

interface ReceiptListProps {
  view: PurchaseReceiptView;
  receipts: PurchaseReceiptCard[];
  loading: boolean;
  error: string | null;
  onViewChange: (view: PurchaseReceiptView) => void;
  onRetry: () => void;
  onOpen: (receipt: PurchaseReceiptCard) => void;
  onDiscard: (receipt: PurchaseReceiptCard) => Promise<{ error: string | null }>;
}

function receiptDateLabel(isoDate: string): string {
  const value = isoDate.includes("T") ? isoDate : `${isoDate}T12:00:00`;
  return formatLastPurchaseHintDate(value);
}

function receiptTotalLabel(value: number | null): string {
  if (value === null) {
    return "No total";
  }
  return formatMoney(value);
}

export function ReceiptList({
  view,
  receipts,
  loading,
  error,
  onViewChange,
  onRetry,
  onOpen,
  onDiscard,
}: ReceiptListProps) {
  const [pending, setPending] = useState<PurchaseReceiptCard | null>(null);
  const [discardError, setDiscardError] = useState<string | null>(null);
  const [isDiscarding, setIsDiscarding] = useState(false);

  async function confirmDiscard() {
    if (!pending || pending.purchaseId) {
      return;
    }
    setIsDiscarding(true);
    const result = await onDiscard(pending);
    setIsDiscarding(false);
    if (result.error) {
      setDiscardError(result.error);
      return;
    }
    setPending(null);
    setDiscardError(null);
  }

  return (
    <section className="space-y-4">
      <div className="grid grid-cols-2 gap-2 rounded-xl bg-zinc-100 p-1">
        <button
          type="button"
          aria-pressed={view === "unassigned"}
          onClick={() => onViewChange("unassigned")}
          className={`min-h-12 rounded-lg text-base font-semibold ${
            view === "unassigned" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-600"
          }`}
        >
          Unassigned
        </button>
        <button
          type="button"
          aria-pressed={view === "recent"}
          onClick={() => onViewChange("recent")}
          className={`min-h-12 rounded-lg text-base font-semibold ${
            view === "recent" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-600"
          }`}
        >
          All recent
        </button>
      </div>

      {loading ? <p className="text-sm text-zinc-600">Loading receipts.</p> : null}

      {error ? (
        <div className="space-y-3 rounded-xl border border-red-200 bg-red-50 p-4">
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="min-h-12 rounded-lg bg-white px-4 text-base font-semibold text-zinc-900"
          >
            Retry
          </button>
        </div>
      ) : null}

      {!loading && !error && receipts.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-600">
          {view === "unassigned"
            ? "No unassigned receipts."
            : "No receipts in the last 60 days."}
        </p>
      ) : null}

      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {receipts.map((receipt) => (
          <li key={receipt.id} className="rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm">
            <button
              type="button"
              onClick={() => onOpen(receipt)}
              className="flex w-full gap-3 text-left"
            >
              {receipt.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- private signed URL, not a static asset
                <img
                  src={receipt.thumbnailUrl}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="h-20 w-16 shrink-0 rounded-lg object-cover"
                />
              ) : (
                <span className="flex h-20 w-16 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-xs text-zinc-500">
                  No photo
                </span>
              )}
              <span className="min-w-0 space-y-1">
                <span className="block text-base font-semibold text-zinc-900">
                  {receiptDateLabel(receipt.receiptDate)}
                </span>
                <span className="block truncate text-sm text-zinc-600">
                  {receipt.supplierName ?? "No supplier"}
                </span>
                <span className="block text-sm text-zinc-800">{receiptTotalLabel(receipt.receiptTotal)}</span>
                {receipt.pageCount > 1 ? (
                  <span className="block text-sm text-zinc-500">{receipt.pageCount} pages</span>
                ) : null}
              </span>
            </button>
            {receipt.purchaseId === null ? (
              <button
                type="button"
                onClick={() => {
                  setDiscardError(null);
                  setPending(receipt);
                }}
                className="mt-3 min-h-12 w-full rounded-lg border border-zinc-300 text-base font-semibold text-zinc-800"
              >
                Discard
              </button>
            ) : null}
          </li>
        ))}
      </ul>

      <ReceiptDiscardDialog
        open={pending !== null}
        isDiscarding={isDiscarding}
        error={discardError}
        onClose={() => {
          if (!isDiscarding) {
            setPending(null);
            setDiscardError(null);
          }
        }}
        onConfirm={() => void confirmDiscard()}
      />
    </section>
  );
}
